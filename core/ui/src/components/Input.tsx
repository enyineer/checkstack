import * as React from "react";
import { cn } from "../utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Marks the field as invalid: applies destructive border/ring styling and
   * sets `aria-invalid` for assistive technology. Additive - the default
   * (non-invalid) appearance is unchanged. An explicit `aria-invalid` prop, if
   * provided, still wins.
   */
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, invalid, "aria-invalid": ariaInvalid, ...props }, ref) => {
    const isInvalid = ariaInvalid ?? invalid;
    return (
      <input
        type={type}
        aria-invalid={isInvalid}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50",
          isInvalid &&
            "border-destructive focus:ring-destructive aria-invalid:border-destructive",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
