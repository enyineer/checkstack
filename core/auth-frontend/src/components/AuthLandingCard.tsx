import React from "react";
import { Card, cn } from "@checkstack/ui";

export interface AuthLandingCardProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * The premium shell shared by the two auth-landing surfaces (Login and
 * Profile): a layered-shadow, gradient card with a thin primary top accent so
 * the two screens read as a matched set and the first screen an operator sees
 * carries a quiet brand cue rather than a stock framework form. The top accent
 * is purely decorative (aria-hidden); all content lives in {children}.
 */
export const AuthLandingCard: React.FC<AuthLandingCardProps> = ({
  children,
  className,
}) => (
  <Card
    className={cn(
      "relative w-full max-w-md overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]",
      className,
    )}
  >
    <span
      className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/0 via-primary/60 to-primary/0"
      aria-hidden
    />
    {children}
  </Card>
);
