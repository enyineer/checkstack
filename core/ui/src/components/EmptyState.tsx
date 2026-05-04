import React from "react";
import { Card, CardContent } from "./Card";
import { cn } from "../utils";

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /**
   * Optional ordered onboarding steps. When supplied, the empty state
   * renders as a "coaching" card explaining how the user gets started.
   * Each step is shown with a numbered chip.
   */
  steps?: React.ReactNode[];
  /**
   * Optional action area (typically a primary CTA button) shown beneath
   * the description / steps. Use this for "Create your first X" buttons.
   */
  actions?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  steps,
  actions,
  className,
  ...props
}) => {
  const isCoaching = (steps && steps.length > 0) || !!actions;

  return (
    <Card
      className={cn("border-dashed border-2 bg-muted/30", className)}
      {...props}
    >
      <CardContent
        className={cn(
          "flex flex-col items-center text-center",
          isCoaching ? "py-10" : "py-12 justify-center",
        )}
      >
        {icon && <div className="text-muted-foreground/40 mb-4">{icon}</div>}
        <p className="text-foreground font-medium">{title}</p>
        {description && (
          <div className="text-sm text-muted-foreground mt-1 max-w-prose">
            {description}
          </div>
        )}
        {steps && steps.length > 0 && (
          <ol className="mt-6 flex flex-col gap-3 text-left max-w-md w-full">
            {steps.map((step, index) => (
              <li
                key={index}
                className="flex items-start gap-3 text-sm text-foreground"
              >
                <span
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        )}
        {actions && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {actions}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
