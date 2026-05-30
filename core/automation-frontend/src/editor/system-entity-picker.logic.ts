/**
 * Pure logic for {@link SystemEntityPicker}, extracted so the manual-entry
 * fallback decision can be unit-tested without rendering the catalog-backed
 * picker (which pulls in `@checkstack/ui` / Monaco).
 */

/**
 * Decides whether the picker should open in manual-entry mode for a given
 * `entity` value and the set of known catalog system ids. Templates and ids
 * that aren't in the catalog drop to manual entry so they still round-trip;
 * a blank value or a known system id uses the live picker.
 */
export function shouldStartManual({
  value,
  knownSystemIds,
}: {
  value: string;
  knownSystemIds: ReadonlySet<string>;
}): boolean {
  if (value.length === 0) return false;
  if (value.includes("{{")) return true;
  return !knownSystemIds.has(value);
}
