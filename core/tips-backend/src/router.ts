import { implement } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
  type RealUser,
  type SafeDatabase,
} from "@checkstack/backend-api";
import { tipsContract } from "@checkstack/tips-common";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema";

/**
 * Creates the tips router using contract-based implementation.
 *
 * Auth is automatically enforced via autoAuthMiddleware based on the
 * contract's meta.userType (all endpoints are userType: "user"), so each
 * call is scoped to the requesting user — there is no admin/cross-user
 * surface.
 */
export const createTipsRouter = (db: SafeDatabase<typeof schema>) => {
  const os = implement(tipsContract)
    .$context<RpcContext>()
    .use(correlationMiddleware)
    .use(autoAuthMiddleware);

  return os.router({
    listDismissed: os.listDismissed.handler(async ({ context }) => {
      const userId = (context.user as RealUser).id;

      const rows = await db
        .select({
          tipId: schema.userTipDismissal.tipId,
          dismissedAt: schema.userTipDismissal.dismissedAt,
        })
        .from(schema.userTipDismissal)
        .where(eq(schema.userTipDismissal.userId, userId));

      return { dismissed: rows };
    }),

    dismiss: os.dismiss.handler(async ({ input, context }) => {
      const userId = (context.user as RealUser).id;
      const { tipId } = input;

      // Idempotent: composite PK on (userId, tipId) means a re-dismiss is a no-op.
      await db
        .insert(schema.userTipDismissal)
        .values([
          {
            userId,
            tipId,
            dismissedAt: new Date(),
          },
        ])
        .onConflictDoNothing({
          target: [
            schema.userTipDismissal.userId,
            schema.userTipDismissal.tipId,
          ],
        });
    }),

    reset: os.reset.handler(async ({ input, context }) => {
      const userId = (context.user as RealUser).id;
      const { tipIds } = input;

      if (tipIds && tipIds.length > 0) {
        await db
          .delete(schema.userTipDismissal)
          .where(
            and(
              eq(schema.userTipDismissal.userId, userId),
              inArray(schema.userTipDismissal.tipId, tipIds),
            ),
          );
        return;
      }

      await db
        .delete(schema.userTipDismissal)
        .where(eq(schema.userTipDismissal.userId, userId));
    }),
  });
};

export type TipsRouter = ReturnType<typeof createTipsRouter>;
