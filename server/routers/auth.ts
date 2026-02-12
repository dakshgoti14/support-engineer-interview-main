import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export const authRouter = router({
  signup: publicProcedure
    .input(
      z.object({
        email: z.string().email().transform((s) => s.toLowerCase()),
        password: z
          .string()
          .min(8, { message: "Password must be at least 8 characters" })
          .refine((pwd) => /[A-Z]/.test(pwd), { message: "Password must contain at least one uppercase letter" })
          .refine((pwd) => /[a-z]/.test(pwd), { message: "Password must contain at least one lowercase letter" })
          .refine((pwd) => /\d/.test(pwd), { message: "Password must contain at least one number" })
          .refine((pwd) => /[!@#$%^&*(),.?":{}|<>]/.test(pwd), {
            message: "Password must contain at least one special character",
          }),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phoneNumber: z.string().regex(/^\+?\d{10,15}$/),
        dateOfBirth: z
          .string()
          .refine((s) => !Number.isNaN(Date.parse(s)), { message: "Invalid date format" })
          .refine((s) => {
            const dob = new Date(s);
            const now = new Date();
            // Reject future dates
            if (dob > now) return false;
            // Reject dates more than 120 years ago (reasonable max age)
            const maxAge = new Date();
            maxAge.setFullYear(maxAge.getFullYear() - 120);
            if (dob < maxAge) return false;
            return true;
          }, { message: "Date of birth cannot be in the future or more than 120 years ago" })
          .refine((s) => {
            const dob = new Date(s);
            const now = new Date();
            const ageMs = now.getTime() - dob.getTime();
            const age = ageMs / (1000 * 60 * 60 * 24 * 365.25);
            return age >= 18;
          }, { message: "You must be at least 18 years old" }),
        ssn: z.string().regex(/^\d{9}$/),
        address: z.string().min(1),
        city: z.string().min(1),
        state: z.string().transform((s) => s.toUpperCase()).refine((s) => US_STATES.includes(s), { message: "Invalid state code" }),
        zipCode: z.string().regex(/^\d{5}$/),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existingUser = await db.select().from(users).where(eq(users.email, input.email)).get();

      if (existingUser) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User already exists",
        });
      }


      const hashedPassword = await bcrypt.hash(input.password, 10);

      // Hash SSN before storing (HMAC with a server-side secret)
      const ssnSecret = process.env.SSN_SECRET || process.env.JWT_SECRET || "temporary-ssn-secret";
      const ssnHash = crypto.createHmac("sha256", ssnSecret).update(input.ssn).digest("hex");

      await db.insert(users).values({
        ...input,
        password: hashedPassword,
        ssn: ssnHash,
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

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "temporary-secret-for-interview", {
        expiresIn: "7d",
      });

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
      const user = await db.select().from(users).where(eq(users.email, input.email)).get();

      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }

      const validPassword = await bcrypt.compare(input.password, user.password);

      if (!validPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }


      // Invalidate existing sessions to prevent multiple concurrent sessions
      await db.delete(sessions).where(eq(sessions.userId, user.id));

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "temporary-secret-for-interview", {
        expiresIn: "7d",
      });

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
    let sessionDeleted = false;

    if (ctx.user) {
      // Delete session from database
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
      if (token) {
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

    if (ctx.user && !sessionDeleted) {
      return { success: false, message: "Failed to invalidate session" };
    }

    return { success: true, message: ctx.user ? "Logged out successfully" : "No active session" };
  }),
});
