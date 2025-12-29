import React from "react";
import { Check } from "lucide-react";
import { cn } from "../utils";

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  className,
  checked,
  onCheckedChange,
  ...props
}) => {
  // Compute styles to avoid nested ternary
  const getBackgroundStyles = () => {
    if (props.disabled) {
      return "bg-gray-100 border-gray-300 cursor-not-allowed";
    }
    if (checked) {
      return "bg-indigo-600 border-indigo-600 cursor-pointer";
    }
    return "bg-white border-indigo-200 cursor-pointer";
  };

  return (
    <div
      className={cn(
        "peer h-4 w-4 shrink-0 rounded-sm border ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 flex items-center justify-center transition-colors",
        getBackgroundStyles(),
        className
      )}
      onClick={() => !props.disabled && onCheckedChange?.(!checked)}
    >
      {checked && (
        <Check
          className={cn(
            "h-3 w-3",
            props.disabled ? "text-gray-400" : "text-white"
          )}
          strokeWidth={3}
        />
      )}
    </div>
  );
};
