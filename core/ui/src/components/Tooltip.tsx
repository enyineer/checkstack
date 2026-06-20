import React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { HelpCircle } from "lucide-react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";
import { usePortalContainer } from "./portalContainer";

export interface TooltipProps {
  content: string;
  className?: string;
  /**
   * Optional custom trigger. When omitted, a focusable help icon
   * (`HelpCircle`) is rendered so keyboard users can open the tooltip.
   */
  children?: React.ReactNode;
}

/**
 * Accessible tooltip built on `@radix-ui/react-tooltip`. Unlike the legacy
 * hover-only `<div>`, the trigger is a real focusable `<button>` so keyboard
 * users can open it (Tab to focus), Radix supplies `role="tooltip"` and
 * collision-aware placement (flip/shift near viewport edges), and the content
 * portals into the nearest Dialog/Sheet when nested so the modal scroll-lock
 * does not clip it. The `{ content, className }` API is unchanged; `children`
 * is an additive opt-in for a custom trigger.
 *
 * A self-contained `Tooltip.Provider` is included so the component works in any
 * tree (host app, public bundle, Storybook) without host-level wiring.
 */
export const Tooltip: React.FC<TooltipProps> = ({
  content,
  className,
  children,
}) => {
  const { isLowPower } = usePerformance();
  const portalContainer = usePortalContainer();

  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children ?? (
            <button
              type="button"
              aria-label="More information"
              className={cn(
                "inline-flex items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                className,
              )}
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          )}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal
          container={portalContainer ?? undefined}
        >
          <TooltipPrimitive.Content
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "z-[100] max-w-xs rounded border border-border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-lg",
              !isLowPower &&
                "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-popover" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
};
