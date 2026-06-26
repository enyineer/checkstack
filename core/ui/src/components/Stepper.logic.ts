/**
 * Lifecycle of a single step relative to the active step.
 *
 * - `completed`: the user has already moved past this step (index < active).
 * - `current`: the step the user is on right now (index === active).
 * - `upcoming`: a step the user has not reached yet (index > active).
 *
 * Kept pure (no React) so the visual `Stepper` and the `useStepper` hook share
 * one source of truth and the branching stays unit-testable without rendering.
 */
export type StepStatus = "completed" | "current" | "upcoming";

/**
 * Resolves a step's {@link StepStatus} from its index and the active index.
 */
export const getStepStatus = ({
  index,
  activeStep,
}: {
  index: number;
  activeStep: number;
}): StepStatus => {
  if (index < activeStep) return "completed";
  if (index === activeStep) return "current";
  return "upcoming";
};

/**
 * Clamps a desired step index into the valid `[0, count - 1]` range so wizard
 * navigation can never point before the first or past the last step. An empty
 * stepper (`count <= 0`) collapses to `0`.
 *
 * Pure + total: never throws, so it is safe to call during render/init.
 */
export const clampStepIndex = ({
  index,
  count,
}: {
  index: number;
  count: number;
}): number => {
  if (count <= 0) return 0;
  return Math.min(Math.max(index, 0), count - 1);
};

/**
 * A step is selectable only when it is already completed AND a select handler
 * was supplied. Users may step BACK to a finished step, never skip AHEAD to a
 * current/upcoming one.
 */
export const isStepSelectable = ({
  index,
  activeStep,
  hasSelectHandler,
}: {
  index: number;
  activeStep: number;
  hasSelectHandler: boolean;
}): boolean => hasSelectHandler && index < activeStep;

/**
 * Whether the connector segment LEAVING `fromIndex` (towards the next step) is
 * complete - i.e. the step it starts at has already been finished. Used to fill
 * the line between two indicators in the active (primary) colour.
 */
export const isConnectorComplete = ({
  fromIndex,
  activeStep,
}: {
  fromIndex: number;
  activeStep: number;
}): boolean => fromIndex < activeStep;
