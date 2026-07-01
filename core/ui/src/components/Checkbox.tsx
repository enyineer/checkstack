import React from "react";
import { Check } from "lucide-react";
import { cn } from "../utils";

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onCheckedChange?: (checked: boolean) => void;
}

/**
 * Accessible checkbox: a real, keyboard-focusable native `<input type="checkbox">`
 * overlaid (transparent) on the styled visual box. This gives it the checkbox
 * ARIA role, Space-to-toggle, a focus-visible ring, and - crucially - lets a
 * wrapping `<label>` forward clicks to it (a plain styled `<div>` can do none of
 * that). `className` styles the visual box, preserving existing call sites.
 */
export const Checkbox: React.FC<CheckboxProps> = ({
  className,
  checked,
  onCheckedChange,
  disabled,
  ...props
}) => {
  // Compute styles to avoid nested ternary.
  const getBackgroundStyles = () => {
    if (disabled) {
      return "bg-muted border-border";
    }
    if (checked) {
      return "bg-primary border-primary";
    }
    return "bg-background border-input";
  };

  return (
    <span className="relative inline-flex shrink-0">
      <input
        {...props}
        type="checkbox"
        checked={checked ?? false}
        disabled={disabled}
        onChange={(e) => !disabled && onCheckedChange?.(e.target.checked)}
        className={cn(
          "peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0",
          disabled && "cursor-not-allowed",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-sm border ring-offset-background transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
          getBackgroundStyles(),
          className,
        )}
      >
        {checked && (
          <Check
            className={cn(
              "h-3 w-3",
              disabled ? "text-muted-foreground" : "text-primary-foreground",
            )}
            strokeWidth={3}
          />
        )}
      </span>
    </span>
  );
};
