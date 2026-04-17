import {
  pgTable,
  text,
  timestamp,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Main announcements table.
 * Stores admin-created portal announcements with temporal lifecycle support.
 */
export const announcements = pgTable("announcements", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  severity: text("severity").notNull().default("info"),
  visibility: text("visibility").notNull().default("all"),
  displayMode: text("display_mode").notNull().default("both"),
  active: boolean("active").notNull().default(true),
  startsAt: timestamp("starts_at"),
  expiresAt: timestamp("expires_at"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Tracks which announcements have been dismissed by which users.
 * Allows server-side persistence of dismissals for authenticated users.
 */
export const announcementDismissals = pgTable(
  "announcement_dismissals",
  {
    announcementId: text("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    dismissedAt: timestamp("dismissed_at").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey(t.announcementId, t.userId),
  }),
);
