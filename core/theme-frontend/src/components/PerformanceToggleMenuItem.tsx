import { Zap, ZapOff } from "lucide-react";
import { Toggle, usePerformance } from "@checkstack/ui";

/**
 * Performance toggle menu item for the UserMenu.
 * Allows users to manually force Low Performance Mode (disabling blurs/animations).
 */
export const PerformanceToggleMenuItem = () => {
  const { manualLowPower, toggleManualLowPower } = usePerformance();

  return (
    <div className="flex items-center justify-between w-full px-4 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors">
      <div className="flex flex-col flex-1 items-start">
        <div className="flex items-center w-full">
          {manualLowPower ? (
            <ZapOff className="h-4 w-4 text-muted-foreground shrink-0 mr-3" />
          ) : (
            <Zap className="h-4 w-4 text-primary shrink-0 mr-3" />
          )}
          <span className="flex-1 text-left">Low Power Mode</span>
        </div>
        <span className="text-[10px] text-muted-foreground mt-1 leading-tight text-left pl-7">
          Disables blurs & animations
        </span>
      </div>
      <div className="ml-2 shrink-0 flex items-center">
        <Toggle
          checked={manualLowPower}
          onCheckedChange={toggleManualLowPower}
          aria-label="Toggle low performance mode"
        />
      </div>
    </div>
  );
};
