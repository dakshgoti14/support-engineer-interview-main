import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { accounts, transactions } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { EncryptionService } from "../services/encryptionService";
import { ValidationService } from "../services/validationService";

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

      // Generate unique account number using cryptographically secure generator
      let accountNumber: string | undefined;
      let isUnique = false;
      let attempts = 0;
      const MAX_ATTEMPTS = 10;

      while (!isUnique && attempts < MAX_ATTEMPTS) {
        accountNumber = EncryptionService.generateAccountNumber();
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
        amount: z.number().positive().min(0.01, { message: "Amount must be at least $0.01" }).max(10000, { message: "Amount cannot exceed $10,000 per transaction" }),
        fundingSource: z.object({
          type: z.enum(["card", "bank"]),
          accountNumber: z.string(),
          routingNumber: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Validate and sanitize amount using centralized validation
      const amountValidation = ValidationService.validateAmount(input.amount);
      if (!amountValidation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: amountValidation.error || "Invalid amount",
        });
      }

      const sanitizedAmount = amountValidation.sanitized;

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

      // Validate funding source using centralized ValidationService
      if (input.fundingSource.type === "bank") {
        if (!input.fundingSource.routingNumber) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Routing number is required for bank transfers" });
        }
        // Use ValidationService for proper ABA checksum validation
        if (!ValidationService.validateRoutingNumber(input.fundingSource.routingNumber)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid routing number" });
        }
      }

      if (input.fundingSource.type === "card") {
        // Use centralized card validation with Luhn algorithm and card type detection
        const cardValidation = ValidationService.validateCardNumber(input.fundingSource.accountNumber);
        if (!cardValidation.valid) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid card number" });
        }
      }

      // Sanitize description to prevent XSS
      const sanitizedDescription = ValidationService.sanitizeHtml(`Funding from ${input.fundingSource.type}`);

      // Create transaction record
      await db.insert(transactions).values({
        accountId: input.accountId,
        type: "deposit",
        amount: sanitizedAmount,
        description: sanitizedDescription,
        status: "completed",
        processedAt: new Date().toISOString(),
      });

      // Fetch the created transaction using proper DB ordering
      const recentTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId))
        .orderBy(desc(transactions.id))
        .limit(1)
        .all();

      const transaction = recentTransactions[0] ?? null;

      // Calculate balance from ledger (source of truth) instead of read-then-write
      const allCompleted = await db
        .select()
        .from(transactions)
        .where(and(eq(transactions.accountId, input.accountId), eq(transactions.status, "completed")))
        .all();

      let newBalance = 0;
      for (const txn of allCompleted) {
        if (txn.type === "deposit") {
          newBalance += txn.amount;
        } else if (txn.type === "withdrawal") {
          newBalance -= txn.amount;
        }
      }
      // Round to prevent floating-point precision errors
      newBalance = Math.round(newBalance * 100) / 100;

      // Update stored balance to match computed balance
      await db
        .update(accounts)
        .set({ balance: newBalance })
        .where(eq(accounts.id, input.accountId));

      return {
        transaction,
        newBalance,
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

      // Use proper DB-level sorting instead of JS sort
      const accountTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId))
        .orderBy(desc(transactions.createdAt))
        .all();

      // Enrich transactions with account type (single query, no N+1)
      const enrichedTransactions = accountTransactions.map((transaction) => ({
        ...transaction,
        accountType: account.accountType,
      }));

      return enrichedTransactions;
    }),
});
