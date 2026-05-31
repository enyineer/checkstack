import React from "react";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@checkstack/ui";

/**
 * Side-sheet host for a single editor item's full configuration.
 *
 * The collapsed summary cards (actions, triggers, conditions) render only a
 * compact row; clicking opens this right-side sheet containing the item's
 * live config form. The form edits the same `value`/`onChange` the inline
 * editor used, so closing the sheet keeps the changes (they're already
 * applied) - there is no draft/commit step.
 *
 * Composite actions nest `ItemSheet`s: a child card inside the parent's sheet
 * body opens its own sheet, which stacks on top via Radix Dialog's portal +
 * overlay. The z-index/overlay layering is handled by the `Sheet` primitive.
 */
export const ItemSheet: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Sheet width. Composite/provider bodies want room, so default to `lg`. */
  size?: "default" | "lg" | "xl" | "full";
  children: React.ReactNode;
}> = ({ open, onOpenChange, title, description, size = "lg", children }) => (
  <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent
      size={size}
      // Stop the click that bubbles from a nested card/menu inside the sheet
      // from being interpreted as a header click on the card behind it.
      onClick={(event) => event.stopPropagation()}
    >
      <SheetHeader>
        <SheetTitle className="truncate">{title}</SheetTitle>
        {description && (
          <SheetDescription className="truncate">
            {description}
          </SheetDescription>
        )}
      </SheetHeader>
      <SheetBody className="space-y-4">{children}</SheetBody>
    </SheetContent>
  </Sheet>
);
