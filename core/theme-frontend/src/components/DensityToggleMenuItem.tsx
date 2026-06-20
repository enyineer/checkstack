import { Rows2, Rows3 } from "lucide-react";
import { Toggle, useDensity } from "@checkstack/ui";

/**
 * Density toggle menu item for the UserMenu.
 *
 * Flips the adaptive component tree between `comfortable` (default, big
 * legible numbers and generous hit targets) and `compact` (~30% more rows
 * per screen for power users / wall displays). The preference is persisted
 * to localStorage by {@link DensityProvider}, so no backend round-trip is
 * needed - mirrors the performance toggle.
 */
export const DensityToggleMenuItem = () => {
  const { density, toggleDensity } = useDensity();
  const isCompact = density === "compact";

  return (
    <div className="flex items-center justify-between w-full px-4 py-2 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground rounded-sm transition-colors">
      <div className="flex flex-col flex-1 items-start">
        <div className="flex items-center w-full">
          {isCompact ? (
            <Rows3 className="h-4 w-4 text-primary shrink-0 mr-3" />
          ) : (
            <Rows2 className="h-4 w-4 text-muted-foreground shrink-0 mr-3" />
          )}
          <span className="flex-1 text-left">Compact Density</span>
        </div>
        <span className="text-[10px] text-muted-foreground mt-1 leading-tight text-left pl-7">
          More rows per screen
        </span>
      </div>
      <div className="ml-2 shrink-0 flex items-center">
        <Toggle
          checked={isCompact}
          onCheckedChange={toggleDensity}
          aria-label="Toggle compact density"
        />
      </div>
    </div>
  );
};
