import React from "react";
import { cva, type VariantProps } from "class-variance-authority";

const infoBannerVariants = cva(
  "relative w-full rounded-lg border px-3 py-2.5 text-sm",
  {
    variants: {
      variant: {
        default: "bg-muted/30 border-border/50 text-muted-foreground",
        info: "bg-info/5 border-info/20 text-info",
        warning: "bg-warning/5 border-warning/20 text-warning",
        success: "bg-success/5 border-success/20 text-success",
        error: "bg-destructive/5 border-destructive/20 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface InfoBannerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof infoBannerVariants> {
  children: React.ReactNode;
}

export const InfoBanner = React.forwardRef<HTMLDivElement, InfoBannerProps>(
  ({ className, variant, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="status"
        className={infoBannerVariants({ variant, className })}
        {...props}
      >
        <div className="flex gap-2.5 items-start">{children}</div>
      </div>
    );
  }
);

InfoBanner.displayName = "InfoBanner";

export const InfoBannerIcon = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={`flex-shrink-0 mt-0.5 opacity-70 ${className || ""}`}
    {...props}
  >
    {children}
  </div>
));

InfoBannerIcon.displayName = "InfoBannerIcon";

export const InfoBannerContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={`flex-1 space-y-0.5 ${className || ""}`}
    {...props}
  />
));

InfoBannerContent.displayName = "InfoBannerContent";

export const InfoBannerTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h6
    ref={ref}
    className={`font-medium text-sm leading-tight ${className || ""}`}
    {...props}
  />
));

InfoBannerTitle.displayName = "InfoBannerTitle";

export const InfoBannerDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={`text-sm leading-relaxed opacity-90 ${className || ""}`}
    {...props}
  />
));

InfoBannerDescription.displayName = "InfoBannerDescription";
