import React from "react";
import { cn } from "../utils";

/**
 * The single, shared alert/callout for the platform. One component, one look:
 * a depth surface (gradient + soft layered shadow) with a left status-accent
 * stripe and a toned icon chip, driven by `variant`. Body text stays in the
 * foreground so the color lands on the signal (stripe + chip + lead), not the
 * whole block. Compose with `AlertIcon` / `AlertContent` / `AlertTitle` /
 * `AlertDescription`.
 */
export type AlertVariant = "default" | "info" | "warning" | "success" | "error";

interface AlertTone {
  /** Border tint. */
  border: string;
  /** Left accent stripe fill. */
  stripe: string;
  /** Icon chip background + foreground. */
  chip: string;
}

const toneByVariant: Record<AlertVariant, AlertTone> = {
  default: {
    border: "border-border/70",
    stripe: "bg-border",
    chip: "bg-surface-inset text-muted-foreground",
  },
  info: {
    border: "border-info/40",
    stripe: "bg-info",
    chip: "bg-info/10 text-info",
  },
  warning: {
    border: "border-status-warn/40",
    stripe: "bg-status-warn",
    chip: "bg-status-warn/10 text-status-warn",
  },
  success: {
    border: "border-status-ok/40",
    stripe: "bg-status-ok",
    chip: "bg-status-ok/10 text-status-ok",
  },
  error: {
    border: "border-status-down/40",
    stripe: "bg-status-down",
    chip: "bg-status-down/10 text-status-down",
  },
};

/** Carries the active variant down to `AlertIcon` so it can tint its chip. */
const AlertVariantContext = React.createContext<AlertVariant>("default");

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  children: React.ReactNode;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "default", children, ...props }, ref) => {
    const tone = toneByVariant[variant];
    return (
      <AlertVariantContext.Provider value={variant}>
        <div
          ref={ref}
          role="alert"
          className={cn(
            "relative w-full overflow-hidden rounded-[var(--d-card-r)] border bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_8px_24px_-14px_hsl(var(--foreground)/0.10)]",
            tone.border,
            className,
          )}
          {...props}
        >
          {/* Status accent stripe: signal by hue + position, not color alone. */}
          <span
            className={cn("absolute inset-y-0 left-0 w-1", tone.stripe)}
            aria-hidden
          />
          <div className="flex items-start gap-3 pl-2">{children}</div>
        </div>
      </AlertVariantContext.Provider>
    );
  },
);

Alert.displayName = "Alert";

/**
 * Icon slot: renders its child inside a tinted, rounded chip whose color
 * follows the parent `Alert`'s variant.
 */
export const AlertIcon = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const variant = React.useContext(AlertVariantContext);
  return (
    <div
      ref={ref}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        toneByVariant[variant].chip,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

AlertIcon.displayName = "AlertIcon";

export const AlertContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("min-w-0 flex-1 space-y-1 self-center", className)}
    {...props}
  />
));

AlertContent.displayName = "AlertContent";

export const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn(
      "text-sm font-semibold leading-tight text-foreground",
      className,
    )}
    {...props}
  />
));

AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm leading-relaxed text-muted-foreground", className)}
    {...props}
  />
));

AlertDescription.displayName = "AlertDescription";
