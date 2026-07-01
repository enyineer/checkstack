ALTER TABLE "announcements" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill distinct order values from existing creation order so the manual
-- ordering is meaningful before an operator ever reorders anything.
UPDATE "announcements" AS a SET "sort_order" = s.rn
FROM (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") - 1 AS rn
  FROM "announcements"
) AS s
WHERE a."id" = s."id";