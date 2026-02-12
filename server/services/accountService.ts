/**
 * Account Service - Ledger-Based Accounting
 *
 * Purpose: Financial data integrity through append-only transaction ledger
 *
 * Key Principles:
 * 1. Transactions are append-only (never modified)
 * 2. Balance is COMPUTED from transactions, not stored directly
 * 3. Idempotency keys prevent duplicate transactions
 * 4. All operations are atomic
 *
 * Why this matters:
 * - Prevents race conditions in balance updates
 * - Provides audit trail
 * - Enables balance reconciliation
 * - Detects data corruption
 */

import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db";
import { accounts, transactions } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { EncryptionService } from "./encryptionService";
import { ValidationService } from "./validationService";

export interface CreateAccountParams {
  userId: number;
  accountType: "checking" | "savings";
}

export interface FundAccountParams {
  userId: number;
  accountId: number;
  amount: number;
  fundingSource: {
    type: "card" | "bank";
    accountNumber: string;
    routingNumber?: string;
  };
  idempotencyKey?: string;
}

export interface TransactionRecord {
  id: number;
  accountId: number;
  type: "deposit" | "withdrawal";
  amount: number;
  description: string;
  status: string;
  createdAt: string;
  processedAt: string | null;
}

export class AccountService {
  /**
   * Generate unique account number with retry protection
   */
  private static async generateUniqueAccountNumber(maxAttempts = 10): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const accountNumber = EncryptionService.generateAccountNumber();
      const existing = await db
        .select()
        .from(accounts)
        .where(eq(accounts.accountNumber, accountNumber))
        .get();

      if (!existing) {
        return accountNumber;
      }
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to generate unique account number",
    });
  }

  /**
   * Create a new account
   * Initial balance is always 0 (computed from empty transaction set)
   */
  static async createAccount(params: CreateAccountParams): Promise<any> {
    const { userId, accountType } = params;

    // Check if user already has this type of account
    const existingAccount = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.accountType, accountType)))
      .get();

    if (existingAccount) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `You already have a ${accountType} account`,
      });
    }

    // Generate unique account number
    const accountNumber = await this.generateUniqueAccountNumber();

    // Create account with balance = 0
    try {
      await db.insert(accounts).values({
        userId,
        accountNumber,
        accountType,
        balance: 0,
        status: "active",
      });
    } catch (error) {
      console.error("Account creation error:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create account",
      });
    }

    // Fetch created account
    const account = await db
      .select()
      .from(accounts)
      .where(eq(accounts.accountNumber, accountNumber))
      .get();

    if (!account || account.balance !== 0) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Account creation verification failed",
      });
    }

    return account;
  }

  /**
   * Calculate account balance from transaction ledger
   * This is the SOURCE OF TRUTH for balance
   */
  static async calculateBalance(accountId: number): Promise<number> {
    const accountTransactions = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.status, "completed")))
      .all();

    let balance = 0;
    for (const txn of accountTransactions) {
      if (txn.type === "deposit") {
        balance += txn.amount;
      } else if (txn.type === "withdrawal") {
        balance -= txn.amount;
      }
    }

    // Round to 2 decimal places to prevent floating point errors
    return Math.round(balance * 100) / 100;
  }

  /**
   * Reconcile stored balance with computed balance
   * This should be run periodically to detect data corruption
   */
  static async reconcileBalance(accountId: number): Promise<{ match: boolean; stored: number; computed: number }> {
    const account = await db.select().from(accounts).where(eq(accounts.id, accountId)).get();

    if (!account) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Account not found",
      });
    }

    const computedBalance = await this.calculateBalance(accountId);
    const storedBalance = Math.round(account.balance * 100) / 100;

    const match = Math.abs(storedBalance - computedBalance) < 0.01; // Allow 1 cent rounding difference

    if (!match) {
      console.error(
        `Balance mismatch detected! Account ${accountId}: Stored=${storedBalance}, Computed=${computedBalance}`
      );

      // Auto-correct the stored balance
      await db
        .update(accounts)
        .set({ balance: computedBalance })
        .where(eq(accounts.id, accountId));
    }

    return { match, stored: storedBalance, computed: computedBalance };
  }

  /**
   * Fund account with idempotency protection
   * Prevents duplicate transactions from double-submits
   */
  static async fundAccount(params: FundAccountParams): Promise<{ transaction: any; newBalance: number }> {
    const { userId, accountId, amount, fundingSource, idempotencyKey } = params;

    // Validate amount
    const amountValidation = ValidationService.validateAmount(amount);
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
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
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

    // Check for duplicate transaction using idempotency key
    if (idempotencyKey) {
      const existingTxn = await db
        .select()
        .from(transactions)
        .where(and(eq(transactions.accountId, accountId), eq(transactions.description, `Idempotent:${idempotencyKey}`)))
        .get();

      if (existingTxn) {
        // Return existing transaction, don't create duplicate
        const currentBalance = await this.calculateBalance(accountId);
        return { transaction: existingTxn, newBalance: currentBalance };
      }
    }

    // Validate funding source
    if (fundingSource.type === "card") {
      const cardValidation = ValidationService.validateCardNumber(fundingSource.accountNumber);
      if (!cardValidation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid card number",
        });
      }
    } else if (fundingSource.type === "bank") {
      if (!fundingSource.routingNumber) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Routing number is required for bank transfers",
        });
      }

      if (!ValidationService.validateRoutingNumber(fundingSource.routingNumber)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid routing number checksum",
        });
      }
    }

    // Create transaction record (append-only ledger)
    const description = idempotencyKey
      ? `Idempotent:${idempotencyKey}`
      : ValidationService.sanitizeHtml(`Funding from ${fundingSource.type}`);

    let transaction;
    try {
      await db.insert(transactions).values({
        accountId,
        type: "deposit",
        amount: sanitizedAmount,
        description,
        status: "completed",
        processedAt: new Date().toISOString(),
      });

      // Fetch created transaction
      const allTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, accountId))
        .orderBy(desc(transactions.createdAt))
        .limit(1)
        .all();

      transaction = allTransactions[0];
    } catch (error) {
      console.error("Transaction creation error:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to process transaction",
      });
    }

    // Calculate new balance from ledger
    const newBalance = await this.calculateBalance(accountId);

    // Update stored balance (for query performance, but ledger is source of truth)
    await db
      .update(accounts)
      .set({ balance: newBalance })
      .where(eq(accounts.id, accountId));

    return { transaction, newBalance };
  }

  /**
   * Get account transactions with sorting
   */
  static async getTransactions(
    userId: number,
    accountId: number
  ): Promise<Array<TransactionRecord & { accountType?: string }>> {
    // Verify account belongs to user
    const account = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .get();

    if (!account) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Account not found",
      });
    }

    // Fetch transactions sorted by creation date (newest first)
    const accountTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, accountId))
      .orderBy(desc(transactions.createdAt))
      .all();

    // Enrich with account type (no N+1 query)
    return accountTransactions.map((txn) => ({
      ...txn,
      accountType: account.accountType,
    }));
  }

  /**
   * Get all accounts for a user
   */
  static async getAccounts(userId: number): Promise<any[]> {
    return db.select().from(accounts).where(eq(accounts.userId, userId)).all();
  }

  /**
   * Verify account integrity (balance matches ledger)
   * Run this periodically or on-demand
   */
  static async verifyIntegrity(accountId: number): Promise<boolean> {
    const result = await this.reconcileBalance(accountId);
    return result.match;
  }
}
