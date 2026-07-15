/**
 * Pure matching between observed `service.name` values (from a stream's
 * telemetry) and catalog systems, used by {@link StreamSystemLinksEditor} to
 * SUGGEST systems a human can explicitly link. Suggestions are never
 * auto-applied - this module only decides which systems to OFFER as chips.
 *
 * A service name matches a system when either:
 * - exact (case-insensitive): the lowercased strings are equal, or
 * - loose (normalized): both reduced to lowercase alphanumerics are equal
 *   (so "checkout-api", "Checkout API" and "checkout_api" all match a
 *   "Checkout API" system).
 *
 * Already-linked systems are excluded (no noise re-suggesting what is linked),
 * each system appears at most once even when several service names match it,
 * and the result is capped and stably ordered by name.
 */

/** A minimal catalog system shape for matching (id + display name). */
export interface SuggestibleSystem {
  id: string;
  name: string;
}

export interface MatchSuggestionsParams {
  /** Observed `service.name` values from the stream. */
  serviceNames: readonly string[];
  /** Candidate systems (already filtered to what the caller may link). */
  systems: readonly SuggestibleSystem[];
  /** System ids already linked - excluded from suggestions. */
  linkedIds: Iterable<string>;
  /** Max chips to display. Defaults to 8. */
  cap?: number;
}

/** Default number of suggestion chips shown. */
export const DEFAULT_SUGGESTION_CAP = 8;

/** Lowercase, strip every non-alphanumeric character for loose matching. */
export function normalizeServiceName(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

/**
 * Returns the systems to suggest as clickable chips: those matched by at least
 * one observed service name, not already linked, de-duplicated, ordered stably
 * by name (case-insensitive, numeric-aware), and capped.
 */
export function matchSuggestions({
  serviceNames,
  systems,
  linkedIds,
  cap = DEFAULT_SUGGESTION_CAP,
}: MatchSuggestionsParams): SuggestibleSystem[] {
  const linked = new Set(linkedIds);

  // Build lookup sets of the observed service names for O(1) membership tests.
  const exactNames = new Set<string>();
  const looseNames = new Set<string>();
  for (const raw of serviceNames) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    exactNames.add(trimmed.toLowerCase());
    const loose = normalizeServiceName(trimmed);
    if (loose) looseNames.add(loose);
  }
  if (exactNames.size === 0) return [];

  const matched: SuggestibleSystem[] = [];
  const seen = new Set<string>();
  for (const system of systems) {
    if (linked.has(system.id) || seen.has(system.id)) continue;
    const lower = system.name.trim().toLowerCase();
    const loose = normalizeServiceName(system.name);
    if (exactNames.has(lower) || (loose && looseNames.has(loose))) {
      matched.push(system);
      seen.add(system.id);
    }
  }

  matched.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  return matched.slice(0, cap);
}
