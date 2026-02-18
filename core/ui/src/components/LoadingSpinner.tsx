import React from "react";
import { cn } from "../utils";

interface LoadingSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
  label?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = "md",
  label = "Loading...",
  className,
  ...props
}) => {
  const sizeClasses = {
    sm: "w-4 h-4 border-2",
    md: "w-8 h-8 border-4",
    lg: "w-12 h-12 border-4",
  };

  return (
    <div
      role="status"
      className={cn("flex justify-center py-12", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      <div
        className={cn(
          "border-indigo-200 border-t-indigo-500 rounded-full animate-spin",
          sizeClasses[size]
        )}
        aria-hidden="true"
      />
    </div>
  );
};
