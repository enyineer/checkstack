import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "./Card";
import { cn } from "../utils";

interface StatusCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: React.ReactNode;
  description?: string;
  icon?: React.ReactNode;
  variant?: "default" | "gradient";
}

export const StatusCard: React.FC<StatusCardProps> = ({
  title,
  value,
  description,
  icon,
  variant = "default",
  className,
  ...props
}) => {
  const isGradient = variant === "gradient";

  return (
    <Card
      className={cn(
        "border-none shadow-sm transition-all duration-200",
        isGradient
          ? "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md active:scale-[0.98]"
          : "bg-card hover:border-border",
        className
      )}
      {...props}
    >
      <CardHeader className="p-4 pb-2">
        <CardTitle
          className={cn(
            "text-sm font-medium",
            isGradient
              ? "text-primary-foreground/90"
              : "text-muted-foreground"
          )}
        >
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "text-2xl font-bold tracking-tight",
              isGradient ? "text-primary-foreground" : "text-foreground"
            )}
          >
            {value}
          </span>
          {icon && (
            <div
              className={cn(
                isGradient
                  ? "text-primary-foreground"
                  : "text-muted-foreground/60"
              )}
            >
              {icon}
            </div>
          )}
        </div>
        {description && (
          <p
            className={cn(
              "mt-1 text-xs",
              isGradient
                ? "text-primary-foreground/80"
                : "text-muted-foreground"
            )}
          >
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
