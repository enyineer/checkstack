import React, { useEffect } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";

const toastVariants = cva(
  "relative flex items-start gap-3 w-full sm:max-w-md rounded-lg p-4 transition-all",
  {
    variants: {
      variant: {
        default:
          "bg-card border-l-4 border-t-2 border-r-2 border-b-4 border-border text-card-foreground shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_10px_15px_-3px_rgba(0,0,0,0.1),0_20px_25px_-5px_rgba(0,0,0,0.05)]",
        success:
          "bg-success border-l-4 border-t-2 border-r-2 border-b-4 border-success-foreground/30 text-success-foreground shadow-[0_4px_6px_-1px_rgba(34,197,94,0.2),0_10px_15px_-3px_rgba(34,197,94,0.2),0_20px_25px_-5px_rgba(34,197,94,0.1)]",
        error:
          "bg-destructive border-l-4 border-t-2 border-r-2 border-b-4 border-destructive-foreground/30 text-destructive-foreground shadow-[0_4px_6px_-1px_rgba(239,68,68,0.2),0_10px_15px_-3px_rgba(239,68,68,0.2),0_20px_25px_-5px_rgba(239,68,68,0.1)]",
        warning:
          "bg-warning border-l-4 border-t-2 border-r-2 border-b-4 border-warning-foreground/30 text-warning-foreground shadow-[0_4px_6px_-1px_rgba(251,191,36,0.2),0_10px_15px_-3px_rgba(251,191,36,0.2),0_20px_25px_-5px_rgba(251,191,36,0.1)]",
        info: "bg-info border-l-4 border-t-2 border-r-2 border-b-4 border-info-foreground/30 text-info-foreground shadow-[0_4px_6px_-1px_rgba(59,130,246,0.2),0_10px_15px_-3px_rgba(59,130,246,0.2),0_20px_25px_-5px_rgba(59,130,246,0.1)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const iconMap = {
  default: Info,
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const iconColorMap = {
  default: "text-card-foreground",
  success: "text-success-foreground",
  error: "text-destructive-foreground",
  warning: "text-warning-foreground",
  info: "text-info-foreground",
};

export interface ToastProps extends VariantProps<typeof toastVariants> {
  id: string;
  message: string;
  duration?: number;
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({
  id,
  message,
  variant = "default",
  duration = 4000,
  onDismiss,
}) => {
  const { isLowPower } = usePerformance();
  const Icon = iconMap[variant || "default"];
  const iconColor = iconColorMap[variant || "default"];
  const [isHovered, setIsHovered] = React.useState(false);
  const [remainingTime, setRemainingTime] = React.useState(duration);
  const startTimeRef = React.useRef<number>(Date.now());

  useEffect(() => {
    if (duration <= 0) return;

    // Reset when duration changes
    setRemainingTime(duration);
    startTimeRef.current = Date.now();
  }, [duration]);

  useEffect(() => {
    if (duration <= 0 || remainingTime <= 0) return;

    // If hovered, don't set a timer
    if (isHovered) return;

    const timer = setTimeout(() => {
      onDismiss(id);
    }, remainingTime);

    // Update start time when timer starts
    startTimeRef.current = Date.now();

    return () => {
      clearTimeout(timer);
      // Calculate how much time has elapsed
      const elapsed = Date.now() - startTimeRef.current;
      setRemainingTime((prev) => Math.max(0, prev - elapsed));
    };
  }, [id, remainingTime, isHovered, onDismiss, duration]);

  const handleMouseEnter = () => setIsHovered(true);
  const handleMouseLeave = () => setIsHovered(false);

  return (
    <div
      className={cn(
        toastVariants({ variant }),
        !isLowPower && "animate-in slide-in-from-right fade-in zoom-in-95 duration-300 hover:-translate-y-1 hover:shadow-2xl cursor-default"
      )}
      role="alert"
      aria-live="polite"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Icon className={cn("h-5 w-5 flex-shrink-0", iconColor)} />
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button
        onClick={() => onDismiss(id)}
        className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};
