/**
 * Pure selection for the event-feed widgets (incidents, maintenance): split a
 * list into ACTIVE and recently-PAST items, age-filter the past ones, sort each
 * group newest-first, and cap both by `limit`. Domain-agnostic — the caller
 * supplies the "is this past?" predicate and the timestamp accessor — so it is
 * unit-tested once and reused by both backends.
 */

export interface SelectEventsArgs<T> {
  items: T[];
  /** True for a resolved incident / completed maintenance. */
  isPast: (item: T) => boolean;
  /** Timestamp used to sort (newest first) AND to age-filter past items. */
  timestampOf: (item: T) => string | Date;
  includePast: boolean;
  pastMaxAgeDays: number;
  limit: number;
  /** `Date.now()` at the call site (injected so the logic stays pure/testable). */
  now: number;
}

export interface SelectedEvents<T> {
  active: T[];
  past: T[];
}

function ms(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function selectEvents<T>({
  items,
  isPast,
  timestampOf,
  includePast,
  pastMaxAgeDays,
  limit,
  now,
}: SelectEventsArgs<T>): SelectedEvents<T> {
  const byNewest = (a: T, b: T) => ms(timestampOf(b)) - ms(timestampOf(a));

  const active = items
    .filter((i) => !isPast(i))
    .toSorted(byNewest)
    .slice(0, limit);

  if (!includePast) return { active, past: [] };

  const cutoff = now - pastMaxAgeDays * 86_400_000;
  const past = items
    .filter((i) => isPast(i) && ms(timestampOf(i)) >= cutoff)
    .toSorted(byNewest)
    .slice(0, limit);

  return { active, past };
}
