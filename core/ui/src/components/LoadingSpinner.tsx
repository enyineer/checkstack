import React from "react";
import { cn } from "../utils";

interface LoadingSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = "md",
  className,
  "aria-label": ariaLabel = "Loading...",
  role = "status",
  ...props
}) => {
  const sizeClasses = {
    sm: "w-4 h-4 border-2",
    md: "w-8 h-8 border-4",
    lg: "w-12 h-12 border-4",
  };

  return (
    <div
      className={cn("flex justify-center py-12", className)}
      role={role}
      aria-label={ariaLabel}
      {...props}
    >
      <div
        className={cn(
          "border-indigo-200 border-t-indigo-500 rounded-full animate-spin",
          sizeClasses[size]
        )}
      />
    </div>
  );
};
