import { Lightbulb, MousePointerClick, RotateCcw } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  useToast,
} from "@checkstack/ui";
import { useResetAllTips } from "../hooks/useResetAllTips";

/**
 * A one-line legend that teaches the two in-app coaching conventions so they
 * don't need re-explaining per page: the amber lightbulb (concept tip) versus
 * the native tooltip (affordance hint). Mirrors the copy the dashboard banner
 * uses for the lightbulb.
 */
const ConventionLegend = () => (
  // `col-span-full`: the desktop user-menu popover is a two-column grid, so
  // without this the legend flows into the column beside "Show tips again".
  <div className="col-span-full px-4 py-2 flex flex-col gap-1.5 text-[11px] leading-snug text-muted-foreground">
    <span className="inline-flex items-start gap-2">
      <Lightbulb
        className="size-3.5 shrink-0 mt-0.5 text-warning"
        aria-hidden="true"
      />
      <span>
        <strong className="text-foreground">Lightbulb</strong> - click for a
        short explanation of a concept.
      </span>
    </span>
    <span className="inline-flex items-start gap-2">
      <MousePointerClick
        className="size-3.5 shrink-0 mt-0.5 text-muted-foreground"
        aria-hidden="true"
      />
      <span>
        <strong className="text-foreground">Tooltip</strong> - hover a control
        for a hint about what it does.
      </span>
    </span>
  </div>
);

/**
 * The Help section of the user menu, contributed to `UserMenuItemsSlot`.
 *
 * This used to be a standalone `?` popover in the navbar, owned by the app
 * shell. It moved here because its remaining contents are tips concepts that
 * this plugin already owns (`useResetAllTips`, the lightbulb convention), and
 * because a static utility does not belong in an icon rail beside the
 * notification bell (a stateful indicator) and the avatar (identity).
 *
 * Its former Documentation link is deliberately NOT reproduced: the sidebar's
 * Documentation group already renders a `Docs` external link on both the
 * desktop rail and the mobile drawer.
 *
 * Rendered inside `UserMenu`'s `MenuCloseContext`, so `DropdownMenuItem` closes
 * the surface on click. Receives the slot's `UserMenuItemsContext`, which it
 * does not need.
 */
export const HelpMenuItems = () => {
  const toast = useToast();
  const { resetAll, isResetting } = useResetAllTips();

  const onReplayTips = () => {
    resetAll();
    toast.success("Tips restored. They'll show again as you navigate.");
  };

  return (
    <>
      <DropdownMenuLabel>Help</DropdownMenuLabel>
      <DropdownMenuItem
        // Full width for the same reason as the legend: the desktop popover is
        // a two-column grid, and a lone item would leave an empty cell beside it.
        className="col-span-full"
        icon={<RotateCcw className="h-4 w-4" />}
        description="Restore dismissed concept tips"
        onClick={onReplayTips}
        closeOnClick={!isResetting}
      >
        Show tips again
      </DropdownMenuItem>
      <ConventionLegend />
      <DropdownMenuSeparator />
    </>
  );
};
