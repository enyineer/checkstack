import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  type RpcContext,
  type RealUser,
} from "@checkstack/backend-api";
import { themeContract } from "@checkstack/theme-common";
import * as schema from "./schema";
import { eq } from "drizzle-orm";
import type { SafeDatabase } from "@checkstack/backend-api";

/**
 * Creates the theme router using contract-based implementation.
 *
 * Auth is automatically enforced via autoAuthMiddleware based on
 * the contract's meta.userType (both endpoints are userType: "user").
 */
export const createThemeRouter = (db: SafeDatabase<typeof schema>) => {
  // Create contract implementer with context type AND auto auth middleware
  const os = implement(themeContract)
    .$context<RpcContext>()
    .use(autoAuthMiddleware);

  return os.router({
    getTheme: os.getTheme.handler(async ({ context }) => {
      // context.user is guaranteed to be RealUser by contract meta
      const userId = (context.user as RealUser).id;

      // Query user theme preference
      const preferences = await db
        .select({ theme: schema.userThemePreference.theme })
        .from(schema.userThemePreference)
        .where(eq(schema.userThemePreference.userId, userId))
        .limit(1);

      // Return preference or default to 'system'
      const theme = preferences[0]?.theme || "system";
      return { theme: theme as "light" | "dark" | "system" };
    }),

    setTheme: os.setTheme.handler(async ({ input, context }) => {
      // context.user is guaranteed to be RealUser by contract meta
      const userId = (context.user as RealUser).id;
      const { theme } = input;

      // Upsert theme preference
      await db
        .insert(schema.userThemePreference)
        .values([
          {
            userId,
            theme,
            updatedAt: new Date(),
          },
        ])
        .onConflictDoUpdate({
          target: [schema.userThemePreference.userId],
          set: {
            theme,
            updatedAt: new Date(),
          },
        });
    }),
  });
};

export type ThemeRouter = ReturnType<typeof createThemeRouter>;
