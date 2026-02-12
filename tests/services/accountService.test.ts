/**
 * AccountService Integration Test Suite
 * Tests ledger-based accounting and transaction management
 *
 * Note: These are integration tests that require database setup
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { accounts, transactions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Create test database instance
let testDb: ReturnType<typeof drizzle>;
let sqliteDb: Database.Database;
let testUserId: number;

// Mock the db module BEFORE importing AccountService
vi.mock("@/lib/db", () => {
  let mockDb: any;
  return {
    get db() {
      return mockDb;
    },
    set db(value: any) {
      mockDb = value;
    },
    closeDb: vi.fn(),
    initDb: vi.fn(),
  };
});

// Import AccountService AFTER mocking
const { AccountService } = await import("@/server/services/accountService");
const dbModule = await import("@/lib/db");

beforeEach(async () => {
  // Create in-memory SQLite database
  sqliteDb = new Database(":memory:");
  testDb = drizzle(sqliteDb);

  // Set the mocked db
  (dbModule as any).db = testDb;

  // Create schema
  sqliteDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      ssn TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      zip_code TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      account_number TEXT UNIQUE NOT NULL,
      account_type TEXT NOT NULL,
      balance REAL DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT
    );
  `);

  // Insert test user
  const userResult = sqliteDb.prepare(`
    INSERT INTO users (email, password, first_name, last_name, phone_number, date_of_birth, ssn, address, city, state, zip_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "test@example.com",
    "hashedpassword",
    "Test",
    "User",
    "5551234567",
    "1990-01-01",
    "encrypted_ssn",
    "123 Test St",
    "Test City",
    "CA",
    "12345"
  );

  testUserId = userResult.lastInsertRowid as number;
});

afterEach(() => {
  sqliteDb.close();
});

describe("AccountService", () => {
  describe("createAccount", () => {
    test("creates checking account successfully", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      expect(account).toBeDefined();
      expect(account.userId).toBe(testUserId);
      expect(account.accountType).toBe("checking");
      expect(account.balance).toBe(0);
      expect(account.status).toBe("active");
      expect(account.accountNumber).toHaveLength(10);
      expect(/^\d{10}$/.test(account.accountNumber)).toBe(true);
    });

    test("creates savings account successfully", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "savings",
      });

      expect(account).toBeDefined();
      expect(account.accountType).toBe("savings");
      expect(account.balance).toBe(0);
    });

    test("prevents duplicate account type for same user", async () => {
      await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      await expect(
        AccountService.createAccount({
          userId: testUserId,
          accountType: "checking",
        })
      ).rejects.toThrow("already have a checking account");
    });

    test("allows user to have both checking and savings", async () => {
      const checking = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      const savings = await AccountService.createAccount({
        userId: testUserId,
        accountType: "savings",
      });

      expect(checking.accountType).toBe("checking");
      expect(savings.accountType).toBe("savings");
    });

    test("generates unique account numbers", async () => {
      const account1 = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      // Create second user
      const user2Result = sqliteDb.prepare(`
        INSERT INTO users (email, password, first_name, last_name, phone_number, date_of_birth, ssn, address, city, state, zip_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "test2@example.com",
        "hashedpassword",
        "Test2",
        "User2",
        "5551234568",
        "1991-01-01",
        "encrypted_ssn2",
        "124 Test St",
        "Test City",
        "CA",
        "12346"
      );

      const account2 = await AccountService.createAccount({
        userId: user2Result.lastInsertRowid as number,
        accountType: "checking",
      });

      expect(account1.accountNumber).not.toBe(account2.accountNumber);
    });
  });

  describe("calculateBalance", () => {
    test("returns 0 for new account with no transactions", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      const balance = await AccountService.calculateBalance(account.id);
      expect(balance).toBe(0);
    });

    test("calculates balance from single deposit", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      sqliteDb.prepare(`
        INSERT INTO transactions (account_id, type, amount, status, processed_at)
        VALUES (?, 'deposit', 100.50, 'completed', datetime('now'))
      `).run(account.id);

      const balance = await AccountService.calculateBalance(account.id);
      expect(balance).toBe(100.50);
    });

    test("calculates balance from multiple deposits", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      sqliteDb.prepare(`
        INSERT INTO transactions (account_id, type, amount, status, processed_at)
        VALUES
          (?, 'deposit', 100.00, 'completed', datetime('now')),
          (?, 'deposit', 50.25, 'completed', datetime('now')),
          (?, 'deposit', 25.75, 'completed', datetime('now'))
      `).run(account.id, account.id, account.id);

      const balance = await AccountService.calculateBalance(account.id);
      expect(balance).toBe(176.00);
    });

    test("calculates balance with deposits and withdrawals", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      sqliteDb.prepare(`
        INSERT INTO transactions (account_id, type, amount, status, processed_at)
        VALUES
          (?, 'deposit', 500.00, 'completed', datetime('now')),
          (?, 'withdrawal', 150.00, 'completed', datetime('now')),
          (?, 'deposit', 100.00, 'completed', datetime('now')),
          (?, 'withdrawal', 50.00, 'completed', datetime('now'))
      `).run(account.id, account.id, account.id, account.id);

      const balance = await AccountService.calculateBalance(account.id);
      expect(balance).toBe(400.00);
    });

    test("ignores pending transactions", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      sqliteDb.prepare(`
        INSERT INTO transactions (account_id, type, amount, status, processed_at)
        VALUES
          (?, 'deposit', 100.00, 'completed', datetime('now')),
          (?, 'deposit', 200.00, 'pending', NULL)
      `).run(account.id, account.id);

      const balance = await AccountService.calculateBalance(account.id);
      expect(balance).toBe(100.00);
    });

    test("handles decimal precision correctly", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      sqliteDb.prepare(`
        INSERT INTO transactions (account_id, type, amount, status, processed_at)
        VALUES
          (?, 'deposit', 0.01, 'completed', datetime('now')),
          (?, 'deposit', 0.02, 'completed', datetime('now')),
          (?, 'deposit', 0.03, 'completed', datetime('now'))
      `).run(account.id, account.id, account.id);

      const balance = await AccountService.calculateBalance(account.id);
      expect(balance).toBe(0.06);
    });
  });

  describe("reconcileBalance", () => {
    test("returns match when stored and computed balance are equal", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      const result = await AccountService.reconcileBalance(account.id);
      expect(result.match).toBe(true);
      expect(result.stored).toBe(0);
      expect(result.computed).toBe(0);
    });

    test("detects and corrects balance mismatch", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      sqliteDb.prepare(`
        INSERT INTO transactions (account_id, type, amount, status, processed_at)
        VALUES (?, 'deposit', 100.00, 'completed', datetime('now'))
      `).run(account.id);

      // Manually corrupt the balance
      sqliteDb.prepare(`
        UPDATE accounts SET balance = 50.00 WHERE id = ?
      `).run(account.id);

      const result = await AccountService.reconcileBalance(account.id);
      expect(result.match).toBe(false);
      expect(result.stored).toBe(50.00);
      expect(result.computed).toBe(100.00);

      // Verify balance was corrected
      const updatedAccount = testDb
        .select()
        .from(accounts)
        .where(eq(accounts.id, account.id))
        .get();

      expect(updatedAccount?.balance).toBe(100.00);
    });

    test("throws error for non-existent account", async () => {
      await expect(
        AccountService.reconcileBalance(99999)
      ).rejects.toThrow("Account not found");
    });
  });

  describe("fundAccount", () => {
    test("funds account with valid card", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      const result = await AccountService.fundAccount({
        userId: testUserId,
        accountId: account.id,
        amount: 500.00,
        fundingSource: {
          type: "card",
          accountNumber: "4532015112830366",
        },
      });

      expect(result.transaction).toBeDefined();
      expect(result.transaction.type).toBe("deposit");
      expect(result.transaction.amount).toBe(500.00);
      expect(result.transaction.status).toBe("completed");
      expect(result.newBalance).toBe(500.00);
    });

    test("funds account with valid bank transfer", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      const result = await AccountService.fundAccount({
        userId: testUserId,
        accountId: account.id,
        amount: 1000.00,
        fundingSource: {
          type: "bank",
          accountNumber: "1234567890",
          routingNumber: "021000021",
        },
      });

      expect(result.newBalance).toBe(1000.00);
    });

    test("rejects invalid card number", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      await expect(
        AccountService.fundAccount({
          userId: testUserId,
          accountId: account.id,
          amount: 500.00,
          fundingSource: {
            type: "card",
            accountNumber: "1234567890123456",
          },
        })
      ).rejects.toThrow("Invalid card number");
    });

    test("rejects invalid routing number", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      await expect(
        AccountService.fundAccount({
          userId: testUserId,
          accountId: account.id,
          amount: 500.00,
          fundingSource: {
            type: "bank",
            accountNumber: "1234567890",
            routingNumber: "123456789",
          },
        })
      ).rejects.toThrow("Invalid routing number checksum");
    });

    test("rejects amount below minimum", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      await expect(
        AccountService.fundAccount({
          userId: testUserId,
          accountId: account.id,
          amount: 0.001,
          fundingSource: {
            type: "card",
            accountNumber: "4532015112830366",
          },
        })
      ).rejects.toThrow("Amount must be at least $0.01");
    });

    test("rejects amount above maximum", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      await expect(
        AccountService.fundAccount({
          userId: testUserId,
          accountId: account.id,
          amount: 10001.00,
          fundingSource: {
            type: "card",
            accountNumber: "4532015112830366",
          },
        })
      ).rejects.toThrow("Amount cannot exceed $10,000");
    });

    test("prevents duplicate transactions with idempotency key", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      const idempotencyKey = "unique-key-123";

      const result1 = await AccountService.fundAccount({
        userId: testUserId,
        accountId: account.id,
        amount: 500.00,
        fundingSource: {
          type: "card",
          accountNumber: "4532015112830366",
        },
        idempotencyKey,
      });

      const result2 = await AccountService.fundAccount({
        userId: testUserId,
        accountId: account.id,
        amount: 500.00,
        fundingSource: {
          type: "card",
          accountNumber: "4532015112830366",
        },
        idempotencyKey,
      });

      expect(result1.newBalance).toBe(500.00);
      expect(result2.newBalance).toBe(500.00);
      expect(result1.transaction.id).toBe(result2.transaction.id);
    });

    test("rejects funding for inactive account", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      sqliteDb.prepare(`
        UPDATE accounts SET status = 'inactive' WHERE id = ?
      `).run(account.id);

      await expect(
        AccountService.fundAccount({
          userId: testUserId,
          accountId: account.id,
          amount: 500.00,
          fundingSource: {
            type: "card",
            accountNumber: "4532015112830366",
          },
        })
      ).rejects.toThrow("Account is not active");
    });

    test("rejects funding for account belonging to different user", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      await expect(
        AccountService.fundAccount({
          userId: testUserId + 999,
          accountId: account.id,
          amount: 500.00,
          fundingSource: {
            type: "card",
            accountNumber: "4532015112830366",
          },
        })
      ).rejects.toThrow("Account not found");
    });

    test("updates stored balance after funding", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      await AccountService.fundAccount({
        userId: testUserId,
        accountId: account.id,
        amount: 250.00,
        fundingSource: {
          type: "card",
          accountNumber: "4532015112830366",
        },
      });

      const updatedAccount = testDb
        .select()
        .from(accounts)
        .where(eq(accounts.id, account.id))
        .get();

      expect(updatedAccount?.balance).toBe(250.00);
    });

    test("handles multiple sequential deposits correctly", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      await AccountService.fundAccount({
        userId: testUserId,
        accountId: account.id,
        amount: 100.00,
        fundingSource: { type: "card", accountNumber: "4532015112830366" },
      });

      await AccountService.fundAccount({
        userId: testUserId,
        accountId: account.id,
        amount: 200.00,
        fundingSource: { type: "card", accountNumber: "4532015112830366" },
      });

      const result = await AccountService.fundAccount({
        userId: testUserId,
        accountId: account.id,
        amount: 300.00,
        fundingSource: { type: "card", accountNumber: "4532015112830366" },
      });

      expect(result.newBalance).toBe(600.00);
    });
  });

  describe("getTransactions", () => {
    test("returns empty array for account with no transactions", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      const txns = await AccountService.getTransactions(testUserId, account.id);
      expect(txns).toEqual([]);
    });

    test("returns transactions sorted by newest first", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      for (let i = 1; i <= 3; i++) {
        sqliteDb.prepare(`
          INSERT INTO transactions (account_id, type, amount, status, created_at, processed_at)
          VALUES (?, 'deposit', ?, 'completed', datetime('now', '-${3-i} seconds'), datetime('now'))
        `).run(account.id, i * 100);
      }

      const txns = await AccountService.getTransactions(testUserId, account.id);

      expect(txns).toHaveLength(3);
      expect(txns[0].amount).toBe(300);
      expect(txns[1].amount).toBe(200);
      expect(txns[2].amount).toBe(100);
    });

    test("enriches transactions with account type", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "savings",
      });

      sqliteDb.prepare(`
        INSERT INTO transactions (account_id, type, amount, status, processed_at)
        VALUES (?, 'deposit', 100, 'completed', datetime('now'))
      `).run(account.id);

      const txns = await AccountService.getTransactions(testUserId, account.id);

      expect(txns[0].accountType).toBe("savings");
    });

    test("throws error when accessing another user's transactions", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      await expect(
        AccountService.getTransactions(testUserId + 999, account.id)
      ).rejects.toThrow("Account not found");
    });

    test("returns both deposits and withdrawals", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      // Insert in chronological order (oldest first)
      sqliteDb.prepare(`
        INSERT INTO transactions (account_id, type, amount, status, created_at, processed_at)
        VALUES (?, 'deposit', 500, 'completed', '2024-01-01 10:00:00', datetime('now'))
      `).run(account.id);

      sqliteDb.prepare(`
        INSERT INTO transactions (account_id, type, amount, status, created_at, processed_at)
        VALUES (?, 'withdrawal', 100, 'completed', '2024-01-01 11:00:00', datetime('now'))
      `).run(account.id);

      sqliteDb.prepare(`
        INSERT INTO transactions (account_id, type, amount, status, created_at, processed_at)
        VALUES (?, 'deposit', 200, 'completed', '2024-01-01 12:00:00', datetime('now'))
      `).run(account.id);

      const txns = await AccountService.getTransactions(testUserId, account.id);

      // Should be sorted by newest first
      expect(txns).toHaveLength(3);
      expect(txns[0].type).toBe("deposit");
      expect(txns[0].amount).toBe(200); // Most recent
      expect(txns[1].type).toBe("withdrawal");
      expect(txns[1].amount).toBe(100); // Middle
      expect(txns[2].type).toBe("deposit");
      expect(txns[2].amount).toBe(500); // Oldest
    });
  });

  describe("edge cases", () => {
    test("handles very small amounts correctly", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      const result = await AccountService.fundAccount({
        userId: testUserId,
        accountId: account.id,
        amount: 0.01,
        fundingSource: { type: "card", accountNumber: "4532015112830366" },
      });

      expect(result.newBalance).toBe(0.01);
    });

    test("handles maximum allowed amount", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      const result = await AccountService.fundAccount({
        userId: testUserId,
        accountId: account.id,
        amount: 10000.00,
        fundingSource: { type: "card", accountNumber: "4532015112830366" },
      });

      expect(result.newBalance).toBe(10000.00);
    });

    test("requires routing number for bank transfers", async () => {
      const account = await AccountService.createAccount({
        userId: testUserId,
        accountType: "checking",
      });

      await expect(
        AccountService.fundAccount({
          userId: testUserId,
          accountId: account.id,
          amount: 500.00,
          fundingSource: {
            type: "bank",
            accountNumber: "1234567890",
          },
        })
      ).rejects.toThrow("Routing number is required");
    });
  });
});
