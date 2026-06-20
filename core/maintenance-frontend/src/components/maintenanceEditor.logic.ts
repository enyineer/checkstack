/**
 * Pure validation logic for the maintenance editor form.
 *
 * Centralizing the checks here lets the ordering and the date-comparison edge
 * cases be unit-tested without the React dialog. The editor derives a per-field
 * error map (mirroring DynamicForm's single-source-of-truth approach) that
 * drives both the inline {@link FormError} messages and submit-validity: the
 * form is valid iff the map is empty, so what disables the submit button and
 * what the user sees can never disagree.
 */

/** The fields of the maintenance editor that can carry a validation error. */
export type MaintenanceFormField = "title" | "systems" | "startAt" | "endAt";

/** Per-field error messages, keyed by {@link MaintenanceFormField}. */
export type MaintenanceFieldErrors = Partial<
  Record<MaintenanceFormField, string>
>;

/** Inputs needed to validate the maintenance editor fields. */
export interface MaintenanceFormValues {
  title: string;
  selectedSystemCount: number;
  startAt: Date | undefined;
  endAt: Date | undefined;
}

/**
 * Derive the per-field error map for the maintenance editor:
 * - `title`: a non-empty (trimmed) title is required;
 * - `systems`: at least one affected system must be selected;
 * - `startAt` / `endAt`: both timestamps must be present, and the end must be
 *   strictly after the start (surfaced on the `endAt` field).
 *
 * Every failing field is reported independently so the user sees all problems
 * at once rather than one-at-a-time. An empty map means the form is valid.
 */
export function deriveMaintenanceFieldErrors({
  title,
  selectedSystemCount,
  startAt,
  endAt,
}: MaintenanceFormValues): MaintenanceFieldErrors {
  const errors: MaintenanceFieldErrors = {};

  if (!title.trim()) {
    errors.title = "Title is required";
  }
  if (selectedSystemCount === 0) {
    errors.systems = "At least one system must be selected";
  }
  if (!startAt) {
    errors.startAt = "Start date is required";
  }
  if (!endAt) {
    errors.endAt = "End date is required";
  } else if (startAt && endAt <= startAt) {
    errors.endAt = "End date must be after start date";
  }

  return errors;
}

/** Whether the derived error map represents a valid (submittable) form. */
export function isMaintenanceFormValid(
  errors: MaintenanceFieldErrors,
): boolean {
  return Object.keys(errors).length === 0;
}
