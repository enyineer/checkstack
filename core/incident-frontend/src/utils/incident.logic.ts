import type { IncidentStatus } from "@checkstack/incident-common";

/**
 * Pure, DOM-free helpers for the incident plugin: list ordering and the two
 * form validators. Kept out of the page/dialog components so the comparator's
 * tie-breaking and the validation ordering are testable in isolation.
 */

/** The minimal incident shape the history list sorts on. */
export interface SortableIncident {
  status: IncidentStatus;
  createdAt: Date | string;
}

/**
 * Sort incidents for the system history list: active (non-resolved) incidents
 * first, then by creation date descending (newest first). Pure and stable with
 * respect to the comparator; does not mutate the input (use with `toSorted`).
 */
export function compareIncidentHistory(
  a: SortableIncident,
  b: SortableIncident,
): number {
  const aActive = a.status === "resolved" ? 1 : 0;
  const bActive = b.status === "resolved" ? 1 : 0;
  if (aActive !== bActive) return aActive - bActive;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/**
 * Sort a copy of the incidents by {@link compareIncidentHistory}. Returns a new
 * array; the input is left untouched.
 */
export function sortIncidentHistory<T extends SortableIncident>(
  incidents: T[],
): T[] {
  return incidents.toSorted(compareIncidentHistory);
}

/** Result of validating an incident-related form. */
export type IncidentFormValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate the incident editor: a non-blank (trimmed) title and at least one
 * affected system, checked in that order (title first).
 */
export function validateIncidentForm({
  title,
  selectedSystemCount,
}: {
  title: string;
  selectedSystemCount: number;
}): IncidentFormValidation {
  if (!title.trim()) {
    return { ok: false, error: "Title is required" };
  }
  if (selectedSystemCount === 0) {
    return { ok: false, error: "At least one system must be selected" };
  }
  return { ok: true };
}

/** The fields of the incident editor that carry inline validation. */
export type IncidentFieldKey = "title" | "systems";

/**
 * Per-field error map for the incident editor. Mirrors the DynamicForm
 * approach: a single map is the source of truth for both the inline messages
 * rendered under each field and submit-validity (valid iff the map is empty).
 * Keys are omitted when the field is valid so callers can check
 * `Object.keys(errors).length === 0`.
 */
export function deriveIncidentFieldErrors({
  title,
  selectedSystemCount,
}: {
  title: string;
  selectedSystemCount: number;
}): Partial<Record<IncidentFieldKey, string>> {
  const errors: Partial<Record<IncidentFieldKey, string>> = {};
  if (!title.trim()) {
    errors.title = "Title is required";
  }
  if (selectedSystemCount === 0) {
    errors.systems = "At least one system must be selected";
  }
  return errors;
}

/**
 * Validate an incident status-update message: a non-blank (trimmed) message is
 * required.
 */
export function validateIncidentUpdate({
  message,
}: {
  message: string;
}): IncidentFormValidation {
  if (!message.trim()) {
    return { ok: false, error: "Update message is required" };
  }
  return { ok: true };
}
