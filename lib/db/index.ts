import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const dbPath = "bank.db";

// HMR-safe singleton: reuse connection across hot reloads in development
const globalForDb = globalThis as unknown as {
  _sqlite?: Database.Database;
  _db?: ReturnType<typeof drizzle>;
};

function createConnection() {
  if (globalForDb._sqlite && globalForDb._db) {
    return { sqlite: globalForDb._sqlite, db: globalForDb._db };
  }

  const sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrency
  sqlite.pragma("journal_mode = WAL");

  // Set reasonable timeout for busy database
  sqlite.pragma("busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });

  // Cache for HMR reuse
  globalForDb._sqlite = sqlite;
  globalForDb._db = db;

  return { sqlite, db };
}

const { sqlite, db: dbInstance } = createConnection();

export const db = dbInstance;

// Cleanup function to close database connection
export function closeDb() {
  if (globalForDb._sqlite) {
    globalForDb._sqlite.close();
    globalForDb._sqlite = undefined;
    globalForDb._db = undefined;
  }
}

// Handle process termination gracefully
if (typeof process !== "undefined") {
  const cleanup = () => {
    closeDb();
  };

  process.on("beforeExit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}

export function initDb() {
  // Create tables if they don't exist using the existing sqlite connection
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
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

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      account_number TEXT UNIQUE NOT NULL,
      account_type TEXT NOT NULL,
      balance REAL DEFAULT 0 NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending' NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// Initialize database on import
initDb();
