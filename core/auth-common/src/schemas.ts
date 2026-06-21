import { z } from "zod";

/**
 * Password validation schema with security requirements.
 * Used for both registration and password reset flows.
 *
 * Requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export type Password = z.infer<typeof passwordSchema>;

/**
 * The individual password requirements, each with a short user-facing label and
 * a predicate. Kept in lock-step with {@link passwordSchema} so a live
 * per-criterion checklist (e.g. the onboarding form) can tick each rule green as
 * the user types instead of only surfacing failures on submit. Sharing the same
 * predicates means the UI checklist and the schema can never drift.
 */
export const PASSWORD_CRITERIA = [
  {
    id: "length",
    label: "At least 8 characters",
    isMet: (password: string) => password.length >= 8,
  },
  {
    id: "uppercase",
    label: "One uppercase letter",
    isMet: (password: string) => /[A-Z]/.test(password),
  },
  {
    id: "lowercase",
    label: "One lowercase letter",
    isMet: (password: string) => /[a-z]/.test(password),
  },
  {
    id: "number",
    label: "One number",
    isMet: (password: string) => /[0-9]/.test(password),
  },
] as const;

export type PasswordCriterion = (typeof PASSWORD_CRITERIA)[number];

/**
 * Evaluate every {@link PASSWORD_CRITERIA} rule against a candidate password,
 * returning each criterion paired with whether it is currently satisfied. Drives
 * the live onboarding checklist.
 */
export function evaluatePasswordCriteria(
  password: string,
): Array<{ id: PasswordCriterion["id"]; label: string; met: boolean }> {
  return PASSWORD_CRITERIA.map((criterion) => ({
    id: criterion.id,
    label: criterion.label,
    met: criterion.isMet(password),
  }));
}
