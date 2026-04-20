import React, { useState, useEffect } from "react";
import { Button } from "./Button";
import { Bell } from "lucide-react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";

export interface SubscribeButtonProps {
  /**
   * Whether the user is currently subscribed
   */
  isSubscribed: boolean;
  /**
   * Called when user clicks to subscribe
   */
  onSubscribe: () => void;
  /**
   * Called when user clicks to unsubscribe
   */
  onUnsubscribe: () => void;
  /**
   * Show loading state
   */
  loading?: boolean;
  /**
   * Button size variant
   */
  size?: "default" | "sm" | "lg" | "icon";
  /**
   * Additional class names
   */
  className?: string;
}

/**
 * Reusable subscribe/unsubscribe button for notification groups.
 * Shows a bell icon that animates when toggling subscription state.
 */
export const SubscribeButton: React.FC<SubscribeButtonProps> = ({
  isSubscribed,
  onSubscribe,
  onUnsubscribe,
  loading = false,
  size = "icon",
  className,
}) => {
  const [animating, setAnimating] = useState(false);
  const { isLowPower } = usePerformance();

  // Trigger animation when subscription state changes
  useEffect(() => {
    if (!loading && !isLowPower) {
      setAnimating(true);
      const timer = setTimeout(() => setAnimating(false), 500);
      return () => clearTimeout(timer);
    }
  }, [isSubscribed, loading, isLowPower]);

  const handleClick = () => {
    if (loading) return;
    if (isSubscribed) {
      onUnsubscribe();
    } else {
      onSubscribe();
    }
  };

  return (
    <Button
      variant={isSubscribed ? "primary" : "ghost"}
      size={size}
      onClick={handleClick}
      disabled={loading}
      className={cn(
        "transition-all duration-200",
        isSubscribed && "text-primary-foreground",
        !isSubscribed && "text-muted-foreground hover:text-foreground",
        className
      )}
      title={
        isSubscribed
          ? "Unsubscribe from notifications"
          : "Subscribe to notifications"
      }
      aria-label={
        loading
          ? isSubscribed
            ? "Unsubscribing..."
            : "Subscribing..."
          : isSubscribed
          ? "Unsubscribe from notifications"
          : "Subscribe to notifications"
      }
      aria-pressed={isSubscribed}
    >
      {loading ? (
        <span
          role="status"
          aria-label="Loading"
          className={cn(
            "h-4 w-4 rounded-full border-2 border-current border-t-transparent",
            !isLowPower && "animate-spin"
          )}
        />
      ) : (
        <Bell
          aria-hidden="true"
          className={cn(
            "h-4 w-4 transition-all duration-300",
            isSubscribed && "fill-current",
            animating && !isLowPower && "animate-bell-ring"
          )}
        />
      )}
    </Button>
  );
};
