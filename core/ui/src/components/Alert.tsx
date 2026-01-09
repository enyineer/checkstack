import React from "react";
import { cva, type VariantProps } from "class-variance-authority";

const alertVariants = cva("relative w-full rounded-md border p-4", {
  variants: {
    variant: {
      default: "bg-muted/50 border-border text-foreground",
      success: "bg-success/10 border-success/30 text-success",
      warning: "bg-warning/10 border-warning/30 text-warning",
      error: "bg-destructive/10 border-destructive/30 text-destructive",
      info: "bg-info/10 border-info/30 text-info",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  children: React.ReactNode;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="alert"
        className={alertVariants({ variant, className })}
        {...props}
      >
        <div className="flex gap-3 items-center">{children}</div>
      </div>
    );
  }
);

Alert.displayName = "Alert";

export const AlertIcon = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={`flex-shrink-0 opacity-70 ${className || ""}`}
    {...props}
  >
    {children}
  </div>
));

AlertIcon.displayName = "AlertIcon";

export const AlertContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={`flex-1 space-y-1 ${className || ""}`} {...props} />
));

AlertContent.displayName = "AlertContent";

export const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={`font-semibold text-sm leading-tight ${className || ""}`}
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
    className={`text-sm leading-relaxed opacity-90 ${className || ""}`}
    {...props}
  />
));

AlertDescription.displayName = "AlertDescription";
