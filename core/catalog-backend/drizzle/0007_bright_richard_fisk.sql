ALTER TABLE "groups" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Backfill a deterministic browse order for pre-existing groups so they do not
-- all collapse onto the default 0. Zero-based to match the create/reorder logic
-- (new groups append at max+1; reorder assigns array index).
UPDATE "groups" AS g
SET "sort_order" = r.rn - 1
FROM (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn
  FROM "groups"
) AS r
WHERE g."id" = r."id";
