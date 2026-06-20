import React from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "./Card";
import { Button } from "./Button";
import { cn } from "../utils";
import {
  DEFAULT_STATE_FOOTPRINT,
  stateFootprintClass,
  type StateFootprint,
} from "./stateFootprint";

interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** Optional retry handler - renders a "Retry" button when provided. */
  onRetry?: () => void;
  /** Label for the retry button. */
  retryLabel?: string;
  /**
   * Vertical footprint. Defaults to `panel` so it matches `EmptyState` and the
   * `panel`/`chart` Skeleton variants - swapping states causes no layout shift.
   */
  footprint?: StateFootprint;
}

/**
 * ErrorState - the canonical full-surface error state for a query-backed
 * panel: a danger-tinted card with an icon, headline, message, and an optional
 * retry action. Shares its footprint with {@link EmptyState} and the
 * `panel`/`chart` Skeleton variants so the loading -> error -> content swap
 * never shifts layout.
 *
 * For a terse inline alert (e.g. above a still-rendered list) prefer
 * {@link QueryErrorState}.
 */
export const ErrorState: React.FC<ErrorStateProps> = ({
  title = "Something went wrong",
  description,
  icon,
  onRetry,
  retryLabel = "Retry",
  footprint = DEFAULT_STATE_FOOTPRINT,
  className,
  ...props
}) => (
  <Card
    className={cn(
      "border-2 border-status-down/40 bg-status-down/5",
      className,
    )}
    {...props}
  >
    <CardContent
      className={cn(
        "flex flex-col items-center justify-center text-center py-12",
        stateFootprintClass(footprint),
      )}
    >
      <div className="text-status-down mb-4" aria-hidden="true">
        {icon ?? <AlertTriangle className="size-8" />}
      </div>
      <p className="text-foreground font-medium">{title}</p>
      {description && (
        <div className="text-sm text-muted-foreground mt-1 max-w-prose">
          {description}
        </div>
      )}
      {onRetry && (
        <div className="mt-6">
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </CardContent>
  </Card>
);
