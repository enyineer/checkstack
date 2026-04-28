import type { ChartType, HealthResultMeta } from "@checkstack/common";
import type { AnomalyDirection } from "../schema";

const TIME_UNITS = new Set([
  "ms", "s", "sec", "μs", "ns", "min", "minutes", "h", "hours", "d", "days", "w", "weeks"
]);

export function inferAnomalyDirection(
  chartType?: ChartType,
  unit?: string,
  meta?: HealthResultMeta
): AnomalyDirection {
  if (meta?.["x-anomaly-direction"]) {
    return meta["x-anomaly-direction"];
  }

  if (!chartType) {
    return "deviation";
  }

  if (chartType === "line") {
    if (unit && TIME_UNITS.has(unit)) {
      return "lower-is-better"; // Durations/latency
    }
    if (unit === "%") {
      return "higher-is-better"; // Availability percentage
    }
    return "deviation";
  }

  if (chartType === "gauge") {
    if (unit === "%") {
      return "higher-is-better"; // Success rates
    }
    return "deviation";
  }

  if (chartType === "boolean" || chartType === "text" || chartType === "status") {
    return "deviation"; // Dominance tracking
  }

  return "deviation";
}
