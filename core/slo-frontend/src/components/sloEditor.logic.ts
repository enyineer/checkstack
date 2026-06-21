/**
 * Pure validation logic for the SLO editor form.
 *
 * The editor keeps its numeric fields as text inputs and parses them on submit.
 * This builder centralizes the parse-and-validate step so the branch coverage
 * (NaN target, out-of-range target, sub-1 window) is testable without the React
 * dialog. The component shows the returned `error` as a toast and only submits
 * when `ok` is true.
 */

/** A validated, parsed SLO form ready to submit. */
export interface ParsedSloForm {
  target: number;
  windowDays: number;
  warningPercent: number;
  criticalPercent: number;
}

/** Result of validating the raw SLO form fields. */
export type SloFormValidation =
  | { ok: true; value: ParsedSloForm }
  | { ok: false; error: string };

/** The raw, still-as-text SLO editor fields a form holds. */
export interface RawSloForm {
  systemId: string;
  target: string;
  windowDays: string;
  warningPercent: string;
  criticalPercent: string;
}

/** Identifiers for the validated SLO fields, used to key the inline error map. */
export type SloFieldKey =
  | "systemId"
  | "target"
  | "windowDays"
  | "warningPercent"
  | "criticalPercent";

/**
 * A per-field error map: a field appears as a key only when it has an error, so
 * an empty object means the form is valid. This is the single source of truth
 * the editor uses for both inline `FormError` messages and submit-validity
 * (valid iff the map is empty), mirroring `DynamicForm`'s `clientErrors`.
 */
export type SloFieldErrors = Partial<Record<SloFieldKey, string>>;

/**
 * Derive the inline per-field error map from the raw editor fields.
 *
 * Unlike {@link validateSloForm} (which short-circuits at the first failure to
 * produce one toast message), this reports every invalid field at once so each
 * can render its own inline error. Burn-rate thresholds are range-checked here
 * to `[0, 100]` so the inputs' `min`/`max` are enforced rather than merely
 * advisory.
 */
export function deriveSloFieldErrors({
  systemId,
  target,
  windowDays,
  warningPercent,
  criticalPercent,
}: RawSloForm): SloFieldErrors {
  const errors: SloFieldErrors = {};

  if (!systemId) {
    errors.systemId = "Please select a system";
  }

  const targetNum = Number.parseFloat(target);
  if (Number.isNaN(targetNum) || targetNum < 0 || targetNum > 100) {
    errors.target = "Target must be between 0 and 100";
  }

  const windowNum = Number.parseInt(windowDays, 10);
  if (Number.isNaN(windowNum) || windowNum < 1) {
    errors.windowDays = "Window must be at least 1 day";
  }

  const warningNum = Number.parseFloat(warningPercent);
  if (Number.isNaN(warningNum) || warningNum < 0 || warningNum > 100) {
    errors.warningPercent = "Warning threshold must be between 0 and 100";
  }

  const criticalNum = Number.parseFloat(criticalPercent);
  if (Number.isNaN(criticalNum) || criticalNum < 0 || criticalNum > 100) {
    errors.criticalPercent = "Critical threshold must be between 0 and 100";
  }

  return errors;
}

/** Whether the derived error map represents a valid (submittable) form. */
export function isSloFormValid(errors: SloFieldErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * Validate and parse the raw SLO editor fields.
 *
 * Rules, in the order the editor checks them:
 * - a system must be selected;
 * - the availability target must parse to a number in `[0, 100]`;
 * - the rolling window must parse to an integer `>= 1` day.
 *
 * Burn-rate threshold percentages are parsed but not range-checked here (the
 * original form left them unconstrained beyond the input `min`/`max`).
 */
export function validateSloForm({
  systemId,
  target,
  windowDays,
  warningPercent,
  criticalPercent,
}: {
  systemId: string;
  target: string;
  windowDays: string;
  warningPercent: string;
  criticalPercent: string;
}): SloFormValidation {
  const targetNum = Number.parseFloat(target);
  const windowNum = Number.parseInt(windowDays, 10);
  const warningNum = Number.parseFloat(warningPercent);
  const criticalNum = Number.parseFloat(criticalPercent);

  if (!systemId) {
    return { ok: false, error: "Please select a system" };
  }
  if (Number.isNaN(targetNum) || targetNum < 0 || targetNum > 100) {
    return { ok: false, error: "Target must be between 0 and 100" };
  }
  if (Number.isNaN(windowNum) || windowNum < 1) {
    return { ok: false, error: "Window must be at least 1 day" };
  }

  return {
    ok: true,
    value: {
      target: targetNum,
      windowDays: windowNum,
      warningPercent: warningNum,
      criticalPercent: criticalNum,
    },
  };
}
