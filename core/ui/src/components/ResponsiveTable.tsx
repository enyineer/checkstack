/**
 * ResponsiveTable - dual-layout primitive for tabular data that must
 * degrade gracefully on narrow viewports.
 *
 * # API decision
 *
 * The original plan considered a context-driven `priority` prop on a
 * special `ResponsiveTableHead` so cells could declare which columns
 * disappear on mobile. Implementing that without `any` requires either
 * (a) cloning every `TableCell` child to inject a context-derived
 * `data-priority` attribute, or (b) maintaining a parallel index of
 * `TableHead` children to wire their priorities into the cells by
 * position. Both shapes leak the matching responsibility into the
 * primitive and produce gnarly typings around the `Table*` re-exports.
 *
 * Instead this file ships the simpler, fully type-safe fallback:
 *
 *   - `<ResponsiveTable>` - a wrapper that renders its children inside
 *     the standard {@link Table} layout on `sm` viewports and up, and
 *     hides them on smaller screens.
 *   - `<MobileCardList>` - a sibling wrapper consumers render alongside
 *     the table. It is only visible below `sm`, so callers compose the
 *     two side-by-side and decide per-row what the mobile presentation
 *     looks like (typically a stacked card with high-priority fields).
 *
 * The two wrappers use Tailwind's `hidden sm:block` / `sm:hidden`
 * utilities, so they swap purely in CSS - no JS media-query gating, no
 * SSR/CSR mismatch risk, and consumers keep full control over which
 * fields surface on mobile.
 *
 * Re-export the standard `Table*` primitives from `@checkstack/ui` for
 * the desktop branch; do NOT use `<table>` markup inside
 * `<MobileCardList>`.
 */
import React from "react";
import { cn } from "../utils";

interface ResponsiveTableProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The desktop tabular layout. Compose with the existing `Table`,
   * `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`
   * primitives.
   */
  children: React.ReactNode;
}

/**
 * Desktop branch of the dual-layout pattern. Hidden below the `sm`
 * breakpoint; render a {@link MobileCardList} alongside it to cover
 * narrow viewports.
 */
export const ResponsiveTable = React.forwardRef<
  HTMLDivElement,
  ResponsiveTableProps
>(({ children, className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("hidden sm:block", className)}
    {...props}
  >
    {children}
  </div>
));

ResponsiveTable.displayName = "ResponsiveTable";

interface MobileCardListProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The stacked, card-shaped layout for narrow viewports. One item per
   * row; consumers decide which fields are surfaced.
   */
  children: React.ReactNode;
}

/**
 * Mobile branch of the dual-layout pattern. Visible only below the `sm`
 * breakpoint. Pairs with {@link ResponsiveTable}.
 */
export const MobileCardList = React.forwardRef<
  HTMLDivElement,
  MobileCardListProps
>(({ children, className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-2 sm:hidden", className)}
    {...props}
  >
    {children}
  </div>
));

MobileCardList.displayName = "MobileCardList";
