import React from "react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";

interface LoadingSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = "md",
  className,
  ...props
}) => {
  const { isLowPower } = usePerformance();

  const sizeClasses = {
    sm: "w-4 h-4 border-2",
    md: "w-8 h-8 border-4",
    lg: "w-12 h-12 border-4",
  };

  return (
    <div className={cn("flex justify-center py-12", className)} {...props}>
      <div
        className={cn(
          "border-muted border-t-primary rounded-full",
          !isLowPower && "animate-spin",
          sizeClasses[size]
        )}
      />
    </div>
  );
};
