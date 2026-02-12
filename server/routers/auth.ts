import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { AuthService } from "../services/authService";
import { EncryptionService } from "../services/encryptionService";
import { ValidationService } from "../services/validationService";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","PR","RI","SC","SD","TN","TX","UT","VT","VA","VI","WA","WV","WI","WY",
];

export const authRouter = router({
  signup: publicProcedure
    .input(
      z.object({
        email: z.string().email().transform((s) => s.toLowerCase()),
        password: z
          .string()
          .min(12, { message: "Password must be at least 12 characters" })
          .refine((pwd) => /[A-Z]/.test(pwd), { message: "Password must contain at least one uppercase letter" })
          .refine((pwd) => /[a-z]/.test(pwd), { message: "Password must contain at least one lowercase letter" })
          .refine((pwd) => /\d/.test(pwd), { message: "Password must contain at least one number" })
          .refine((pwd) => /[!@#$%^&*(),.?":{}|<>]/.test(pwd), {
            message: "Password must contain at least one special character",
          })
          .refine((pwd) => {
            const commonPasswords = ["password", "12345678", "qwerty", "password123", "admin123"];
            return !commonPasswords.some((common) => pwd.toLowerCase().includes(common));
          }, { message: "Password is too common" }),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phoneNumber: z.string().regex(/^\+?\d{10,15}$/),
        dateOfBirth: z
          .string()
          .refine((s) => !Number.isNaN(Date.parse(s)), { message: "Invalid date format" })
          .refine((s) => {
            const result = ValidationService.validateDateOfBirth(s);
            return result.valid;
          }, { message: "You must be at least 18 years old and date must be valid" }),
        ssn: z.string().regex(/^\d{9}$/),
        address: z.string().min(1),
        city: z.string().min(1),
        state: z.string().transform((s) => s.toUpperCase()).refine((s) => US_STATES.includes(s), { message: "Invalid state code" }),
        zipCode: z.string().regex(/^\d{5}$/),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Validate email for common typos
      const emailValidation = ValidationService.validateEmail(input.email);
      if (!emailValidation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: emailValidation.warning || "Invalid email address",
        });
      }

      const existingUser = await db.select().from(users).where(eq(users.email, input.email)).get();

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User already exists",
        });
      }

      // Use AuthService for proper bcrypt rounds (12)
      const hashedPassword = await AuthService.hashPassword(input.password);

      // Encrypt SSN using AES-256-GCM (not just hash - allows retrieval if needed)
      const encryptedSsn = EncryptionService.encrypt(input.ssn);

      await db.insert(users).values({
        ...input,
        password: hashedPassword,
        ssn: encryptedSsn,
      });

      // Fetch the created user
      const user = await db.select().from(users).where(eq(users.email, input.email)).get();

      if (!user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user",
        });
      }

      // Create session - invalidate previous sessions for this user (single session policy)
      await db.delete(sessions).where(eq(sessions.userId, user.id));

      const token = AuthService.createSession(user.id);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: expiresAt.toISOString(),
      });

      // Set cookie
      if ("setHeader" in ctx.res) {
        ctx.res.setHeader("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      } else {
        (ctx.res as Headers).set("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      }

      // Don't expose password or SSN in response
      const safeUser = { ...(user as Record<string, unknown>) };
      delete (safeUser as Record<string, unknown>).password;
      delete (safeUser as Record<string, unknown>).ssn;

      return { user: safeUser, token };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const normalizedEmail = input.email.toLowerCase().trim();

      // Check account lockout
      const lockStatus = AuthService.isAccountLocked(normalizedEmail);
      if (lockStatus.locked) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Account temporarily locked. Try again in ${lockStatus.remainingTime} seconds.`,
        });
      }

      const user = await db.select().from(users).where(eq(users.email, normalizedEmail)).get();

      if (!user) {
        AuthService.recordFailedLogin(normalizedEmail);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }

      const validPassword = await AuthService.verifyPassword(input.password, user.password);

      if (!validPassword) {
        AuthService.recordFailedLogin(normalizedEmail);

        const lockCheck = AuthService.isAccountLocked(normalizedEmail);
        const remaining = lockCheck.locked ? 0 : Math.max(0, 2);

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

      // Successful login - reset failed attempts
      AuthService.resetLoginAttempts(normalizedEmail);

      // Invalidate existing sessions to prevent multiple concurrent sessions
      await db.delete(sessions).where(eq(sessions.userId, user.id));

      const token = AuthService.createSession(user.id);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: expiresAt.toISOString(),
      });

      if ("setHeader" in ctx.res) {
        ctx.res.setHeader("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      } else {
        (ctx.res as Headers).set("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      }

      const safeUser = { ...(user as Record<string, unknown>) };
      delete (safeUser as Record<string, unknown>).password;
      delete (safeUser as Record<string, unknown>).ssn;
      return { user: safeUser, token };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    // Extract token from cookies regardless of auth state
    let token: string | undefined;
    if ("cookies" in ctx.req) {
      const maybeReq = ctx.req as { cookies?: Record<string, string> };
      token = maybeReq.cookies?.session;
    } else {
      const headers = ctx.req.headers as unknown as { get?: (k: string) => string | null; cookie?: string };
      const cookieHeader = headers.get?.("cookie") || headers.cookie;
      token = cookieHeader
        ?.split("; ")
        .find((c: string) => c.startsWith("session="))
        ?.split("=")[1];
    }

    let sessionDeleted = false;
    if (token) {
      // Verify session exists before deletion
      const existingSession = await db.select().from(sessions).where(eq(sessions.token, token)).get();
      if (existingSession) {
        await db.delete(sessions).where(eq(sessions.token, token));
        sessionDeleted = true;
      }
    }

    // Clear the cookie
    if ("setHeader" in ctx.res) {
      ctx.res.setHeader("Set-Cookie", `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    } else {
      (ctx.res as Headers).set("Set-Cookie", `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    }

    if (token && !sessionDeleted) {
      return { success: false, message: "Failed to invalidate session" };
    }

    return { success: true, message: token ? "Logged out successfully" : "No active session" };
  }),
});
