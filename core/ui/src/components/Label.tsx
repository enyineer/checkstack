import * as React from "react";
import { cn } from "../utils";

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /**
   * Renders a required affordance: a visible `*` (token-colored, hidden from
   * assistive tech) plus an `sr-only` "(required)" so the requirement is
   * conveyed to screen readers, not by color alone. Additive - omitting it
   * leaves the label unchanged.
   */
  required?: boolean;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <>
          <span className="text-destructive ml-0.5" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      )}
    </label>
  ),
);
Label.displayName = "Label";
