import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db";

export const auth = betterAuth({
  appName: "LedgerDesk",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
    // Avoid stale cookie-cache vs DB mismatches that surface as "Failed to get session".
    cookieCache: {
      enabled: process.env.NODE_ENV === "production",
      maxAge: 60 * 5,
    },
  },
  user: {
    additionalFields: {
      globalRole: {
        type: "string",
        required: false,
        defaultValue: "USER",
        input: false,
      },
      banned: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  trustedOrigins: [
    process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ],
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
