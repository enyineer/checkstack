/**
 * Auto-chart slot extension registration.
 *
 * Registers the AutoChartGrid as a diagram extension that renders
 * for all strategies that have schema metadata.
 */

import { createSlotExtension } from "@checkmate-monitor/frontend-api";
import {
  HealthCheckDiagramSlot,
  type HealthCheckDiagramSlotContext,
} from "../slots";
import { AutoChartGrid } from "./AutoChartGrid";

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
    return <AutoChartGrid context={context} />;
  },
});
