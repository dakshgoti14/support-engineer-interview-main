/**
 * Authentication Service
 *
 * Purpose: Centralized authentication logic with security hardening
 * Features:
 * - Account lockout after failed attempts
 * - Session management
 * - Password validation
 * - Rate limiting support
 */

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface LoginAttempt {
  email: string;
  attempts: number;
  lockedUntil: Date | null;
}

export class AuthService {
  private static readonly BCRYPT_ROUNDS = 12;
  private static readonly MAX_LOGIN_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
  private static readonly SESSION_DURATION_DAYS = 7;

  // In-memory store for login attempts (in production, use Redis)
  private static loginAttempts = new Map<string, LoginAttempt>();

  /**
   * Hash password using bcrypt with 12 rounds
   */
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.BCRYPT_ROUNDS);
  }

  /**
   * Verify password against hash
   */
  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Check if account is locked due to failed login attempts
   */
  static isAccountLocked(email: string): { locked: boolean; remainingTime?: number } {
    const attempt = this.loginAttempts.get(email.toLowerCase());

    if (!attempt || !attempt.lockedUntil) {
      return { locked: false };
    }

    const now = new Date();
    if (now < attempt.lockedUntil) {
      const remainingMs = attempt.lockedUntil.getTime() - now.getTime();
      return { locked: true, remainingTime: Math.ceil(remainingMs / 1000) };
    }

    // Lockout expired, reset attempts
    this.loginAttempts.delete(email.toLowerCase());
    return { locked: false };
  }

  /**
   * Record failed login attempt
   * Locks account after MAX_LOGIN_ATTEMPTS
   */
  static recordFailedLogin(email: string): void {
    const normalizedEmail = email.toLowerCase();
    const attempt = this.loginAttempts.get(normalizedEmail) || {
      email: normalizedEmail,
      attempts: 0,
      lockedUntil: null,
    };

    attempt.attempts += 1;

    if (attempt.attempts >= this.MAX_LOGIN_ATTEMPTS) {
      attempt.lockedUntil = new Date(Date.now() + this.LOCKOUT_DURATION_MS);
      console.warn(`Account locked: ${normalizedEmail} (${attempt.attempts} failed attempts)`);
    }

    this.loginAttempts.set(normalizedEmail, attempt);
  }

  /**
   * Reset failed login attempts (after successful login)
   */
  static resetLoginAttempts(email: string): void {
    this.loginAttempts.delete(email.toLowerCase());
  }

  /**
   * Authenticate user with email and password
   * Includes account lockout protection
   */
  static async authenticate(
    email: string,
    password: string
  ): Promise<{ user: any; token: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    // Check if account is locked
    const lockStatus = this.isAccountLocked(normalizedEmail);
    if (lockStatus.locked) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Account temporarily locked. Try again in ${lockStatus.remainingTime} seconds.`,
      });
    }

    // Find user
    const user = await db.select().from(users).where(eq(users.email, normalizedEmail)).get();

    if (!user) {
      this.recordFailedLogin(normalizedEmail);
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    }

    // Verify password
    const validPassword = await this.verifyPassword(password, user.password);

    if (!validPassword) {
      this.recordFailedLogin(normalizedEmail);

      // Calculate remaining attempts
      const attempt = this.loginAttempts.get(normalizedEmail);
      const remaining = this.MAX_LOGIN_ATTEMPTS - (attempt?.attempts || 0);

      if (remaining > 0 && remaining <= 2) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: `Invalid credentials. ${remaining} attempts remaining before lockout.`,
        });
      }

      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
      });
    }

    // Successful login - reset attempts
    this.resetLoginAttempts(normalizedEmail);

    // Invalidate all previous sessions (single session policy)
    await db.delete(sessions).where(eq(sessions.userId, user.id));

    // Create new session
    const token = this.createSession(user.id);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.SESSION_DURATION_DAYS);

    await db.insert(sessions).values({
      userId: user.id,
      token,
      expiresAt: expiresAt.toISOString(),
    });

    // Return user without sensitive data
    const safeUser = { ...user };
    delete (safeUser as any).password;
    delete (safeUser as any).ssn;

    return { user: safeUser, token };
  }

  /**
   * Create JWT session token
   */
  static createSession(userId: number): string {
    const secret = process.env.JWT_SECRET || "temporary-secret-for-interview";

    if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET must be set in production");
    }

    return jwt.sign(
      { userId, iat: Math.floor(Date.now() / 1000) },
      secret,
      { expiresIn: `${this.SESSION_DURATION_DAYS}d` }
    );
  }

  /**
   * Verify JWT token
   */
  static verifyToken(token: string): { userId: number } | null {
    try {
      const secret = process.env.JWT_SECRET || "temporary-secret-for-interview";
      const decoded = jwt.verify(token, secret) as { userId: number };
      return decoded;
    } catch {
      return null;
    }
  }

  /**
   * Invalidate session
   */
  static async invalidateSession(token: string): Promise<boolean> {
    try {
      await db.delete(sessions).where(eq(sessions.token, token));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate session and check expiry
   * Treats sessions expiring within 5 minutes as expired
   */
  static async validateSession(token: string): Promise<any | null> {
    const decoded = this.verifyToken(token);
    if (!decoded) {
      return null;
    }

    const session = await db.select().from(sessions).where(eq(sessions.token, token)).get();

    if (!session) {
      return null;
    }

    const expiresAt = new Date(session.expiresAt);
    const now = new Date();
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();

    // Treat as expired if less than 5 minutes remaining
    if (timeUntilExpiry <= 5 * 60 * 1000) {
      await this.invalidateSession(token);
      return null;
    }

    const user = await db.select().from(users).where(eq(users.id, decoded.userId)).get();

    if (!user) {
      return null;
    }

    // Return user without sensitive data
    const safeUser = { ...user };
    delete (safeUser as any).password;
    delete (safeUser as any).ssn;

    return safeUser;
  }

  /**
   * Clean up expired sessions (should be run periodically)
   */
  static async cleanupExpiredSessions(): Promise<number> {
    try {
      // Note: This would need to be adapted based on Drizzle ORM's capabilities
      // For SQLite, we can use raw SQL
      const now = new Date().toISOString();
      // In production, implement proper cleanup with Drizzle syntax
      console.log(`Cleanup: removing sessions expired before ${now}`);
      return 0; // Return count of deleted sessions
    } catch (error) {
      console.error("Session cleanup error:", error);
      return 0;
    }
  }
}
