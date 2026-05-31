/**
 * Pure version-field autofill logic for the "Allowed packages" form, extracted
 * from the React wiring so the load-bearing decisions are unit-testable without
 * a DOM/component harness.
 *
 * The flow has two distinct signals that must NOT clobber a user's manual pin:
 *
 * - The user picks a search suggestion → seed the version from the hit (its
 *   version is typically the latest published one).
 * - The full version list later resolves with a `latest` dist-tag → upgrade
 *   the field to `latest`, but ONLY when it is still empty (so a value seeded
 *   from the hit, or a manually-typed pin, is preserved).
 */

/** Version chosen when a search suggestion is picked: the hit's version, else empty. */
export function versionFromHit(hit: { version?: string }): string {
  return hit.version ?? "";
}

/**
 * Next version value when the registry's version list resolves. Applies
 * `latest` only when the current field is blank; otherwise keeps the current
 * value untouched. Returns `current` unchanged when there is no `latest`.
 */
export function applyLatestDistTag({
  current,
  latest,
}: {
  current: string;
  latest?: string;
}): string {
  if (latest && current.trim().length === 0) return latest;
  return current;
}
