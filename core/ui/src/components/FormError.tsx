import * as React from "react";
import { cn } from "../utils";

export interface FormErrorProps
  extends React.HTMLAttributes<HTMLParagraphElement> {
  /**
   * The error message to display. When falsy, nothing is rendered so callers
   * can pass a possibly-undefined error without a surrounding conditional.
   */
  children?: React.ReactNode;
}

/**
 * Canonical inline field-error slot for hand-rolled forms. Renders
 * `text-sm text-destructive` with `role="alert"` so assistive tech announces
 * the validation message. Give it an `id` and reference it from the input's
 * `aria-describedby` to wire the field to its error.
 */
export const FormError = React.forwardRef<
  HTMLParagraphElement,
  FormErrorProps
>(({ className, children, ...props }, ref) => {
  if (!children) return null;
  return (
    <p
      ref={ref}
      role="alert"
      className={cn("text-sm text-destructive", className)}
      {...props}
    >
      {children}
    </p>
  );
});
FormError.displayName = "FormError";
