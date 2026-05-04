---
title: "System Detail Page Redesign — Implementation Plan"
description: "> For Claude: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task."
---
# System Detail Page Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the system detail page with a hero banner, two-column layout, plugin metric tiles, and a health check slide-over drawer.

**Architecture:** The catalog-frontend `SystemDetailPage` gets a hero banner with a new `SystemOverviewMetricsSlot`, two-column layout (monitoring left, metadata right), and the healthcheck-frontend replaces inline accordions with compact cards that open a slide-over drawer. A new `MetricTile` shared component ensures visual consistency across plugin contributions.

**Tech Stack:** React, TypeScript, Tailwind CSS, Radix UI (Dialog primitives for drawer), Extension Slots

**Design Doc:** `docs/plans/2026-04-23-system-detail-redesign.md`

---

## Task 1: Create `MetricTile` UI Component

**Files:**
- Create: `core/ui/src/components/MetricTile.tsx`
- Create: `core/ui/src/components/MetricTile.test.tsx`
- Modify: `core/ui/src/index.ts`

**Step 1: Write the test**

```tsx
// core/ui/src/components/MetricTile.test.tsx
import { describe, test, expect } from "bun:test";
import { render, screen } from "@testing-library/react";
import { MetricTile } from "./MetricTile";
import { Activity } from "lucide-react";

describe("MetricTile", () => {
  test("renders label and value", () => {
    render(<MetricTile icon={Activity} label="Health" value="2/2 Healthy" />);
    expect(screen.getByText("Health")).toBeTruthy();
    expect(screen.getByText("2/2 Healthy")).toBeTruthy();
  });

  test("renders subtitle when provided", () => {
    render(
      <MetricTile icon={Activity} label="SLO" value="99.95%" subtitle="30d window" />
    );
    expect(screen.getByText("30d window")).toBeTruthy();
  });

  test("applies success variant class", () => {
    const { container } = render(
      <MetricTile icon={Activity} label="Health" value="OK" variant="success" />
    );
    const tile = container.firstChild as HTMLElement;
    expect(tile.className).toContain("border-success");
  });

  test("applies destructive variant class", () => {
    const { container } = render(
      <MetricTile icon={Activity} label="Incidents" value="2" variant="destructive" />
    );
    const tile = container.firstChild as HTMLElement;
    expect(tile.className).toContain("border-destructive");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd core/ui && bun test src/components/MetricTile.test.tsx
```

Expected: FAIL — module not found

**Step 3: Implement MetricTile**

```tsx
// core/ui/src/components/MetricTile.tsx
import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../utils";

const metricTileVariants = cva(
  "flex items-center gap-3 rounded-lg border bg-card p-3 min-w-0",
  {
    variants: {
      variant: {
        default: "border-border",
        success: "border-success/30 bg-success/5",
        warning: "border-warning/30 bg-warning/5",
        destructive: "border-destructive/30 bg-destructive/5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface MetricTileProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof metricTileVariants> {
  icon: React.ElementType;
  label: string;
  value: string;
  subtitle?: string;
}

export const MetricTile: React.FC<MetricTileProps> = ({
  icon: Icon,
  label,
  value,
  subtitle,
  variant,
  className,
  ...props
}) => (
  <div className={cn(metricTileVariants({ variant }), className)} {...props}>
    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground truncate">{label}</p>
      <p className="text-sm font-semibold truncate">{value}</p>
      {subtitle && (
        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
      )}
    </div>
  </div>
);
```

**Step 4: Add export to `core/ui/src/index.ts`**

Add line: `export * from "./components/MetricTile";`

**Step 5: Run test to verify it passes**

```bash
cd core/ui && bun test src/components/MetricTile.test.tsx
```

**Step 6: Commit**

```bash
git add core/ui/src/components/MetricTile.tsx core/ui/src/components/MetricTile.test.tsx core/ui/src/index.ts
git commit -m "feat(ui): add MetricTile component for system overview metrics"
```

---

## Task 2: Create `Sheet` (Drawer) UI Component

**Files:**
- Create: `core/ui/src/components/Sheet.tsx`
- Modify: `core/ui/src/index.ts`

**Step 1: Implement Sheet component**

Use `@radix-ui/react-dialog` (already a dependency) to build a slide-over drawer — same pattern as the existing `Dialog.tsx` but positioned on the right edge instead of centered.

```tsx
// core/ui/src/components/Sheet.tsx
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "../utils";
import { usePerformance } from "./PerformanceProvider";

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => {
  const { isLowPower } = usePerformance();
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 bg-black/50",
        !isLowPower &&
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  );
});
SheetOverlay.displayName = "SheetOverlay";

const sheetContentVariants = cva(
  "fixed z-50 flex flex-col bg-background shadow-lg border-l border-border",
  {
    variants: {
      size: {
        default: "w-full sm:max-w-lg",
        lg: "w-full sm:max-w-2xl",
        xl: "w-full sm:max-w-4xl",
        full: "w-full",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetContentVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, size, ...props }, ref) => {
  const { isLowPower } = usePerformance();
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          sheetContentVariants({ size }),
          "inset-y-0 right-0 h-full",
          !isLowPower &&
            "duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = "SheetContent";

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col gap-1.5 p-6 pb-4 border-b border-border", className)}
    {...props}
  />
);

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = "SheetDescription";

const SheetBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex-1 overflow-y-auto p-6", className)}
    {...props}
  />
);

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetTitle,
  SheetDescription,
};
```

**Step 2: Add export to `core/ui/src/index.ts`**

Add line: `export * from "./components/Sheet";`

**Step 3: Commit**

```bash
git add core/ui/src/components/Sheet.tsx core/ui/src/index.ts
git commit -m "feat(ui): add Sheet (slide-over drawer) component"
```

---

## Task 3: Create `SystemOverviewMetricsSlot` in catalog-common

**Files:**
- Modify: `core/catalog-common/src/slots.ts`

**Step 1: Add the new slot definition**

Add to the end of `core/catalog-common/src/slots.ts`:

```typescript
/**
 * Slot for displaying at-a-glance metric tiles in the system detail hero banner.
 * Plugins contribute compact MetricTile components showing key stats.
 * Extensions receive the full system object.
 *
 * @example
 * import { SystemOverviewMetricsSlot } from "@checkstack/catalog-common";
 *
 * extensions: [{
 *   id: "my-plugin.system-overview-metric",
 *   slotId: SystemOverviewMetricsSlot.id,
 *   component: ({ system }) => <MyMetricTile system={system} />,
 * }]
 */
export const SystemOverviewMetricsSlot = createSlot<{ system: System }>(
  "plugin.catalog.system-overview-metrics"
);
```

**Step 2: Commit**

```bash
git add core/catalog-common/src/slots.ts
git commit -m "feat(catalog-common): add SystemOverviewMetricsSlot"
```

---

## Task 4: Rewrite `SystemDetailPage.tsx` — Hero Banner + Two-Column Layout

**Files:**
- Modify: `core/catalog-frontend/src/components/SystemDetailPage.tsx`

**Step 1: Rewrite the component**

This is the core layout change. The component should:
1. Import `SystemOverviewMetricsSlot` from catalog-common
2. Render a hero banner with: breadcrumb, system name + status badges, metric strip slot
3. Render a two-column layout below: left = monitoring slots, right = system info/contacts/groups/metadata
4. Remove all the heavy Card wrappers from the right column sections

Key structural changes:
- Replace `PageLayout` with direct `Page`/`PageHeader`/`PageContent` usage for more layout control
- Add `SystemOverviewMetricsSlot` rendering in the hero area
- Move `SystemStateBadgesSlot` into the title row
- Use `lg:grid lg:grid-cols-[1fr_340px] lg:gap-6` for the two-column layout
- Right column uses borderless sections with dividers instead of Cards
- Mobile: single column, monitoring content first

**Step 2: Run typecheck and lint**

```bash
bun run typecheck && bun run lint
```

**Step 3: Commit**

```bash
git add core/catalog-frontend/src/components/SystemDetailPage.tsx
git commit -m "feat(catalog-frontend): redesign SystemDetailPage with hero banner and two-column layout"
```

---

## Task 5: Create `HealthCheckDrawer` Component

**Files:**
- Create: `core/healthcheck-frontend/src/components/HealthCheckDrawer.tsx`

**Step 1: Create the drawer component**

Extract the existing `ExpandedDetails` logic from `HealthCheckSystemOverview.tsx` into a new `HealthCheckDrawer` component that uses the `Sheet` component. Organize content into three zones:
- Zone 1: Summary metric tiles (Status, Avg Response, Success Rate, Errors) using `MetricTile`
- Zone 2: Timeline charts (Status Timeline, Execution Duration, extension diagrams) with date range filter
- Zone 3: Recent Runs table with "View all runs →" link

The component receives the same props as the old `ExpandedDetails` but renders inside a `Sheet`/`SheetContent` instead of inline.

**Step 2: Commit**

```bash
git add core/healthcheck-frontend/src/components/HealthCheckDrawer.tsx
git commit -m "feat(healthcheck-frontend): add HealthCheckDrawer slide-over component"
```

---

## Task 6: Rewrite `HealthCheckSystemOverview` — Compact Cards + Drawer

**Files:**
- Modify: `core/healthcheck-frontend/src/components/HealthCheckSystemOverview.tsx`

**Step 1: Simplify to compact card list**

Replace the accordion-based layout with:
1. A Card container with a list of health check rows
2. Each row: check name, strategy badge, status badge, sparkline, last run time
3. Clicking a row opens the `HealthCheckDrawer` via Sheet state
4. Remove all inline expansion logic (the `ExpandedDetails` component and `expandedRow` state)
5. Replace with `selectedCheck` state that controls the drawer open/close

**Step 2: Run typecheck and lint**

```bash
bun run typecheck && bun run lint
```

**Step 3: Commit**

```bash
git add core/healthcheck-frontend/src/components/HealthCheckSystemOverview.tsx
git commit -m "feat(healthcheck-frontend): replace accordion with compact cards + drawer"
```

---

## Task 7: Add Metric Tile Extensions to Plugins

**Files:**
- Create: `core/healthcheck-frontend/src/components/SystemHealthMetricTile.tsx`
- Modify: `core/healthcheck-frontend/src/index.tsx`
- Create: `core/slo-frontend/src/components/SystemSloMetricTile.tsx`
- Modify: `core/slo-frontend/src/index.tsx`
- Create: `core/incident-frontend/src/components/SystemIncidentMetricTile.tsx`
- Modify: `core/incident-frontend/src/index.tsx`
- Create: `core/maintenance-frontend/src/components/SystemMaintenanceMetricTile.tsx`
- Modify: `core/maintenance-frontend/src/index.tsx`

**Step 1: Create health check metric tile**

```tsx
// core/healthcheck-frontend/src/components/SystemHealthMetricTile.tsx
// Uses HealthCheckApi.getSystemHealthOverview to show "X/Y Healthy"
// Renders MetricTile with Heart icon, variant based on status
```

**Step 2: Register in healthcheck-frontend/src/index.tsx**

Add `createSlotExtension(SystemOverviewMetricsSlot, { id: "healthcheck.system-overview-metric", component: SystemHealthMetricTile })` to extensions array. Import `SystemOverviewMetricsSlot` from `@checkstack/catalog-common`.

**Step 3: Repeat for SLO, Incident, Maintenance plugins**

Each creates a small metric tile component and registers it for `SystemOverviewMetricsSlot`.

- SLO: Shows worst SLO budget (e.g., "99.95% / 30d"), Target icon
- Incident: Shows active incident count, AlertTriangle icon
- Maintenance: Shows active/scheduled count, Wrench icon

**Step 4: Run typecheck and lint**

```bash
bun run typecheck && bun run lint
```

**Step 5: Commit**

```bash
git add core/healthcheck-frontend/ core/slo-frontend/ core/incident-frontend/ core/maintenance-frontend/
git commit -m "feat: add SystemOverviewMetricsSlot extensions for all plugins"
```

---

## Task 8: Verify & Polish

**Step 1: Run full typecheck and lint**

```bash
bun run typecheck && bun run lint
```

**Step 2: Manual visual verification**

Start dev server and verify:
- System detail page renders hero banner with metric tiles
- Two-column layout works on desktop
- Mobile responsive layout stacks correctly
- Health check drawer opens from compact cards
- Charts render in correct zones inside drawer
- All existing functionality preserved (signals, pagination, deep links)

**Step 3: Create changeset**

```bash
bunx changeset
```

Select affected packages: `@checkstack/ui`, `@checkstack/catalog-common`, `@checkstack/catalog-frontend`, `@checkstack/healthcheck-frontend`, `@checkstack/slo-frontend`, `@checkstack/incident-frontend`, `@checkstack/maintenance-frontend`

Type: minor (new feature)
Summary: "Redesign system detail page with hero banner, two-column layout, plugin metric tiles, and health check slide-over drawer"

**Step 4: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for system detail redesign"
```
