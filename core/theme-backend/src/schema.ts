import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// User theme preference table
export const userThemePreference = pgTable("user_theme_preference", {
  userId: text("user_id").primaryKey(), // References user from auth system
  theme: text("theme").notNull().default("system"), // 'light', 'dark', or 'system'
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
