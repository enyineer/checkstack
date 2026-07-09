import { z } from "zod";

/**
 * The update CATEGORIES a status-page email subscriber can opt into. A single
 * fan-out notification maps to exactly one of these, derived from the source
 * plugin that published it (see {@link sourcePluginIdToCategory}):
 *
 *  - `incident`     - incident created / updated / resolved.
 *  - `maintenance`  - scheduled-maintenance created / updated / completed.
 *  - `health`       - health-check / status changes.
 *
 * A subscriber whose stored `categories` is non-null only receives fan-out for
 * the categories it lists; a NULL `categories` (legacy rows created before this
 * feature) means "every category" for backward compatibility.
 */
export const SubscriptionCategorySchema = z.enum([
  "incident",
  "maintenance",
  "health",
]);
export type SubscriptionCategory = z.infer<typeof SubscriptionCategorySchema>;

/** Every category value, in display order. */
export const SUBSCRIPTION_CATEGORIES: readonly SubscriptionCategory[] =
  SubscriptionCategorySchema.options;

/**
 * Categories a NEW subscription defaults to when the visitor does not choose:
 * incidents + scheduled maintenance ON, health/status changes OFF (they are the
 * noisiest and least relevant to a non-technical visitor).
 */
export const DEFAULT_SUBSCRIPTION_CATEGORIES: readonly SubscriptionCategory[] = [
  "incident",
  "maintenance",
];

/** Short, non-technical labels for each category (public subscribe UI + admin). */
export const SUBSCRIPTION_CATEGORY_LABELS: Record<SubscriptionCategory, string> =
  {
    incident: "Incidents",
    maintenance: "Scheduled maintenance",
    health: "Health & status changes",
  };

/**
 * Pure mapping from a notification's SOURCE plugin id (the subscription spec's
 * `ownerPlugin`, threaded through the audience event as `sourcePluginId`) to the
 * subscriber-facing {@link SubscriptionCategory}. Returns `null` for any source
 * that is not one of the three user-facing categories, so a scoped subscriber
 * never receives an uncategorized update while a legacy (NULL-categories)
 * subscriber still receives everything.
 *
 * Kept pure and dependency-free so it is unit-testable and shared by the backend
 * fan-out and (if needed) the frontend without either owning the mapping.
 */
const CATEGORY_BY_SOURCE_PLUGIN: Readonly<Record<string, SubscriptionCategory>> =
  {
    incident: "incident",
    maintenance: "maintenance",
    healthcheck: "health",
  };

export function sourcePluginIdToCategory(
  sourcePluginId: string,
): SubscriptionCategory | null {
  return CATEGORY_BY_SOURCE_PLUGIN[sourcePluginId] ?? null;
}

/**
 * Membership set of valid category values, typed `ReadonlySet<string>` so
 * `.has(someString)` type-checks without a cast (a `Set<SubscriptionCategory>`
 * would only accept a `SubscriptionCategory` argument).
 */
const VALID_CATEGORIES: ReadonlySet<string> = new Set(SUBSCRIPTION_CATEGORIES);

/**
 * Clamp a caller-supplied category list to the valid, deduped set. Invalid
 * values are silently dropped (never rejected - preserving the subscribe
 * endpoint's constant response). When nothing valid remains (or the caller
 * supplied nothing), falls back to {@link DEFAULT_SUBSCRIPTION_CATEGORIES} so a
 * new subscription always has a meaningful scope. Pure and side-effect free.
 */
export function clampSubscriptionCategories(
  raw: readonly string[] | undefined,
): SubscriptionCategory[] {
  const valid = (raw ?? []).filter((c): c is SubscriptionCategory =>
    VALID_CATEGORIES.has(c),
  );
  const deduped = [...new Set(valid)];
  return deduped.length > 0 ? deduped : [...DEFAULT_SUBSCRIPTION_CATEGORIES];
}

/**
 * Clamp a caller-supplied `systemIds` to those the page actually surfaces.
 * Returns `null` ("all systems") when the caller supplied none OR when every
 * supplied id was dropped as not-surfaced - so the endpoint never reveals which
 * systems exist by treating an unknown id differently. Pure and side-effect
 * free.
 *
 * NOTE: the all-dropped case deliberately falls back to `null` = "all surfaced
 * systems" rather than "none". This is a broader scope than the caller nominally
 * asked for, but it is NOT a leak (the response is constant and the public form
 * only ever offers surfaced systems), and representing "none" would silently
 * produce a subscription that receives nothing - a worse surprise. A caller that
 * truly wants a narrower scope re-submits with surfaced ids.
 */
export function clampSubscriptionSystemIds(args: {
  requested: readonly string[] | undefined;
  surfaced: ReadonlySet<string>;
}): string[] | null {
  const requested = args.requested ?? [];
  if (requested.length === 0) return null;
  const kept = [...new Set(requested.filter((id) => args.surfaced.has(id)))];
  return kept.length > 0 ? kept : null;
}
