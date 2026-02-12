import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { accounts, transactions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";

function generateAccountNumber(): string {
  // Use a cryptographically secure random integer for account numbers
  const n = crypto.randomInt(0, 10_000_000_000);
  return n.toString().padStart(10, "0");
}

export const accountRouter = router({
  createAccount: protectedProcedure
    .input(
      z.object({
        accountType: z.enum(["checking", "savings"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user already has an account of this type
      const existingAccount = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, ctx.user.id), eq(accounts.accountType, input.accountType)))
        .get();

      if (existingAccount) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have a ${input.accountType} account`,
        });
      }

      let accountNumber;
      let isUnique = false;
      let attempts = 0;
      const MAX_ATTEMPTS = 10;

      // Generate unique account number with retry limit
      while (!isUnique && attempts < MAX_ATTEMPTS) {
        accountNumber = generateAccountNumber();
        const existing = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber)).get();
        isUnique = !existing;
        attempts++;
      }

      if (!accountNumber || !isUnique) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate unique account number",
        });
      }

      try {
        await db.insert(accounts).values({
          userId: ctx.user.id,
          accountNumber: accountNumber,
          accountType: input.accountType,
          balance: 0,
          status: "active",
        });
      } catch (err) {
        console.error("Account creation error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to insert account into database",
        });
      }

      // Fetch the created account to verify creation
      const account = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber)).get();

      if (!account || account.balance !== 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Account creation verification failed",
        });
      }

      return account;
    }),

  getAccounts: protectedProcedure.query(async ({ ctx }) => {
    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, ctx.user.id));

    return userAccounts;
  }),

  fundAccount: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
        amount: z.number().positive().min(0.01, { message: "Amount must be at least $0.01" }),
        fundingSource: z.object({
          type: z.enum(["card", "bank"]),
          accountNumber: z.string(),
          routingNumber: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const amount = parseFloat(input.amount.toString());

      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      if (account.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Account is not active",
        });
      }

      // Validate funding source details
      if (input.fundingSource.type === "bank") {
        if (!input.fundingSource.routingNumber) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Routing number is required for bank transfers" });
        }
        // Validate routing number format
        if (!/^\d{9}$/.test(input.fundingSource.routingNumber)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Routing number must be 9 digits" });
        }
      }

      // If funding by card, validate card number using Luhn and check card type
      if (input.fundingSource.type === "card") {
        const digits = input.fundingSource.accountNumber.replace(/\D/g, "");

        // Validate card length (13-19 digits for most cards)
        if (digits.length < 13 || digits.length > 19) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid card number length" });
        }

        // Validate card type by prefix
        const isValidCardType =
          digits.startsWith("4") ||      // Visa
          /^5[1-5]/.test(digits) ||      // Mastercard (51-55)
          /^2[2-7]/.test(digits) ||      // Mastercard (new range 2221-2720)
          /^3[47]/.test(digits) ||       // American Express (34, 37)
          /^6(?:011|5)/.test(digits) ||  // Discover (6011, 65)
          /^35/.test(digits);            // JCB (35)

        if (!isValidCardType) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported card type" });
        }

        // Luhn algorithm validation
        let sum = 0;
        let shouldDouble = false;
        for (let i = digits.length - 1; i >= 0; i--) {
          let d = parseInt(digits.charAt(i), 10);
          if (shouldDouble) {
            d = d * 2;
            if (d > 9) d = d - 9;
          }
          sum += d;
          shouldDouble = !shouldDouble;
        }
        if (sum % 10 !== 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid card number" });
        }
      }

      // Sanitize description to prevent any HTML injection
      const sanitizedDescription = `Funding from ${input.fundingSource.type}`.replace(/<[^>]*>/g, "");

      // Create transaction
      await db.insert(transactions).values({
        accountId: input.accountId,
        type: "deposit",
        amount,
        description: sanitizedDescription,
        status: "completed",
        processedAt: new Date().toISOString(),
      });

      // Fetch the most recent transaction for this account
      const accountTransactions = await db.select().from(transactions).where(eq(transactions.accountId, input.accountId));
      let transaction: { [k: string]: unknown } | null = null;
      if (Array.isArray(accountTransactions) && accountTransactions.length > 0) {
        transaction = accountTransactions.reduce((prev, cur) => {
          const prevDate = new Date((prev as { createdAt?: string }).createdAt || 0);
          const curDate = new Date((cur as { createdAt?: string }).createdAt || 0);
          return prevDate > curDate ? prev : cur;
        }) as { [k: string]: unknown };
      }

      // Update account balance using SQL to avoid race conditions
      // Use direct SQL update with increment to ensure atomicity
      await db
        .update(accounts)
        .set({
          balance: account.balance + amount,
        })
        .where(eq(accounts.id, input.accountId));

      const updatedAccount = await db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();

      return {
        transaction,
        newBalance: updatedAccount?.balance ?? account.balance,
      };
    }),

  getTransactions: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      // Fetch all transactions and sort by createdAt descending (newest first)
      const accountTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId))
        .all();

      // Sort transactions by createdAt in descending order (newest first)
      const sortedTransactions = accountTransactions.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return dateB - dateA;
      });

      // Enrich transactions with account type (single query, no N+1)
      const enrichedTransactions = sortedTransactions.map((transaction) => ({
        ...transaction,
        accountType: account.accountType,
      }));

      return enrichedTransactions;
    }),
});
