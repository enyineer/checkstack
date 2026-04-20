import { Zap, ZapOff } from "lucide-react";
import { Toggle, usePerformance } from "@checkstack/ui";

/**
 * Performance toggle menu item for the UserMenu.
 * Allows users to manually force Low Performance Mode (disabling blurs/animations).
 */
export const PerformanceToggleMenuItem = () => {
  const { manualLowPower, toggleManualLowPower } = usePerformance();

  return (
    <div className="flex items-center justify-between w-full px-4 py-2 text-sm text-popover-foreground">
      <div className="flex items-center gap-2">
        {manualLowPower ? (
          <ZapOff className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Zap className="h-4 w-4 text-primary" />
        )}
        <div className="flex flex-col">
          <span>Low Power Mode</span>
          <span className="text-[10px] text-muted-foreground leading-tight">
            Disables blurs & animations
          </span>
        </div>
      </div>
      <Toggle
        checked={manualLowPower}
        onCheckedChange={toggleManualLowPower}
        aria-label="Toggle low performance mode"
      />
    </div>
  );
};
