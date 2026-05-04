import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Records that a given user has dismissed a given tip.
 *
 * The composite primary key on (userId, tipId) makes dismissal idempotent —
 * issuing `dismiss` twice for the same tip is a no-op.
 */
export const userTipDismissal = pgTable(
  "user_tip_dismissal",
  {
    userId: text("user_id").notNull(),
    tipId: text("tip_id").notNull(),
    dismissedAt: timestamp("dismissed_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.tipId] }),
  }),
);
