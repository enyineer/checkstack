import React, { useCallback, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";
import {
  clampStepIndex,
  getStepStatus,
  isConnectorComplete,
  isStepSelectable,
  type StepStatus,
} from "./Stepper.logic";

export interface StepperStep {
  id: string;
  title: string;
  description?: string;
  optional?: boolean;
}

export interface StepperProps {
  steps: StepperStep[];
  /** Zero-based index of the current step. */
  activeStep: number;
  /** Optional: clicking an already-completed step navigates back to it. */
  onStepSelect?: (index: number) => void;
  className?: string;
}

// Indicator chip shared by every status: a 36px circle that holds either a step
// number or - once completed - a check. Colour comes from the per-status class.
const indicatorBase =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-medium";

const indicatorStatusClass: Record<StepStatus, string> = {
  completed: "border-primary bg-primary text-primary-foreground",
  current: "border-primary bg-background text-primary font-semibold",
  upcoming: "border-border bg-card text-muted-foreground",
};

const titleStatusClass: Record<StepStatus, string> = {
  completed: "text-foreground font-medium",
  current: "text-foreground font-semibold",
  upcoming: "text-muted-foreground font-medium",
};

/**
 * Presentational horizontal stepper indicator. Completed steps show a check,
 * the active step is highlighted, and future steps are muted. Completed steps
 * become buttons when `onStepSelect` is supplied so users can navigate BACK;
 * current/upcoming steps are never clickable.
 *
 * Respects `usePerformance().isLowPower`: all colour transitions are gated, so
 * low-power devices jump straight to the target state.
 */
export function Stepper({
  steps,
  activeStep,
  onStepSelect,
  className,
}: StepperProps): React.JSX.Element {
  const { isLowPower } = usePerformance();
  const hasSelectHandler = Boolean(onStepSelect);
  const lastIndex = steps.length - 1;

  const connectorClass = (filled: boolean, hidden: boolean) =>
    cn(
      "h-0.5 flex-1 rounded-full",
      // Edge connectors stay in the layout (keeping each indicator centred in
      // its equal-width column) but are visually hidden.
      hidden ? "invisible" : filled ? "bg-primary" : "bg-border",
      !isLowPower && !hidden && "transition-colors duration-300",
    );

  return (
    <nav aria-label="Progress" className={cn("w-full", className)}>
      <ol className="flex w-full items-start">
        {steps.map((step, index) => {
          const status = getStepStatus({ index, activeStep });
          const selectable = isStepSelectable({
            index,
            activeStep,
            hasSelectHandler,
          });
          const isFirst = index === 0;
          const isLast = index === lastIndex;
          const leftFilled = isConnectorComplete({
            fromIndex: index - 1,
            activeStep,
          });
          const rightFilled = isConnectorComplete({ fromIndex: index, activeStep });

          const indicatorContent =
            status === "completed" ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              index + 1
            );

          const indicator = selectable ? (
            <button
              type="button"
              onClick={() => onStepSelect?.(index)}
              aria-label={`Go to step ${index + 1}: ${step.title}`}
              className={cn(
                indicatorBase,
                indicatorStatusClass[status],
                "cursor-pointer hover:border-primary/80 hover:bg-primary/90",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                !isLowPower && "transition-colors duration-200",
              )}
            >
              {indicatorContent}
            </button>
          ) : (
            <span
              className={cn(
                indicatorBase,
                indicatorStatusClass[status],
                !isLowPower && "transition-colors duration-200",
              )}
            >
              {indicatorContent}
            </span>
          );

          return (
            <li
              key={step.id}
              className="relative flex flex-1 flex-col items-center"
              aria-current={status === "current" ? "step" : undefined}
            >
              <div className="flex w-full items-center">
                <span
                  aria-hidden="true"
                  className={connectorClass(leftFilled, isFirst)}
                />
                {indicator}
                <span
                  aria-hidden="true"
                  className={connectorClass(rightFilled, isLast)}
                />
              </div>
              <div className="mt-2 flex min-w-0 flex-col items-center gap-0.5 px-2 text-center">
                <span className={cn("text-sm break-words", titleStatusClass[status])}>
                  {step.title}
                </span>
                {step.optional && (
                  <span className="text-xs text-muted-foreground">Optional</span>
                )}
                {step.description && (
                  <span className="text-xs text-muted-foreground break-words">
                    {step.description}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface UseStepperResult {
  activeStep: number;
  isFirst: boolean;
  isLast: boolean;
  next: () => void;
  back: () => void;
  goTo: (index: number) => void;
  reset: () => void;
}

/**
 * Small controlled-index helper for wizard flows. Keeps the active step inside
 * `[0, count - 1]` for every transition - `next`/`back`/`goTo` clamp, so callers
 * never have to guard the bounds themselves.
 */
export function useStepper({
  count,
  initial = 0,
}: {
  count: number;
  initial?: number;
}): UseStepperResult {
  const [activeStep, setActiveStep] = useState(() =>
    clampStepIndex({ index: initial, count }),
  );

  const goTo = useCallback(
    (index: number) => {
      setActiveStep(clampStepIndex({ index, count }));
    },
    [count],
  );

  const next = useCallback(() => {
    setActiveStep((current) => clampStepIndex({ index: current + 1, count }));
  }, [count]);

  const back = useCallback(() => {
    setActiveStep((current) => clampStepIndex({ index: current - 1, count }));
  }, [count]);

  const reset = useCallback(() => {
    setActiveStep(clampStepIndex({ index: initial, count }));
  }, [count, initial]);

  return {
    activeStep,
    isFirst: activeStep <= 0,
    isLast: activeStep >= count - 1,
    next,
    back,
    goTo,
    reset,
  };
}
