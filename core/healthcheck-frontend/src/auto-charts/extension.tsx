/**
 * Auto-chart slot extension registration.
 *
 * Registers the AutoChartGrid as a diagram extension that renders
 * for all strategies that have schema metadata.
 */

import { lazy, Suspense } from "react";
import { createSlotExtension } from "@checkstack/frontend-api";
import { Skeleton } from "@checkstack/ui";
import {
  HealthCheckDiagramSlot,
  type HealthCheckDiagramSlotContext,
} from "../slots";

// Lazy-loaded: AutoChartGrid pulls in recharts (~300 KB). This extension is
// registered eagerly at plugin load, so a static import would ship recharts in
// the initial bundle even though charts only render inside the (on-demand)
// HealthCheckDiagramSlot. Deferring it keeps recharts out of the initial load.
const AutoChartGrid = lazy(() =>
  import("./AutoChartGrid").then((m) => ({ default: m.AutoChartGrid })),
);

/**
 * Extension that renders auto-generated charts for any strategy.
 *
 * Unlike custom chart extensions that filter by strategy ID, this extension
 * renders for all strategies and lets AutoChartGrid decide what to display
 * based on the schema metadata.
 */
export const autoChartExtension = createSlotExtension(HealthCheckDiagramSlot, {
  id: "healthcheck.auto-charts",
  component: (context: HealthCheckDiagramSlotContext) => {
    return (
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <AutoChartGrid context={context} />
      </Suspense>
    );
  },
});
