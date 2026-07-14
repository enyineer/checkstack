import type { ImportantEventType } from "@checkstack/tracestream-common";
import type { StatusTone } from "@checkstack/ui";
import {
  Gauge,
  Layers,
  Network,
  Route,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";

export interface ImportantEventVisual {
  icon: LucideIcon;
  tone: StatusTone;
  label: string;
}

/**
 * Icon + tone + label for a trace-stream important-event type, so the viewer's
 * timeline renders each event kind with a consistent, type-specific glyph. Pure
 * and unit-tested so a new event type can never silently render with no visual.
 * The exhaustive switch (no default) makes an unhandled type a typecheck error.
 */
export function importantEventVisual(
  type: ImportantEventType,
): ImportantEventVisual {
  switch (type) {
    case "silence": {
      return { icon: VolumeX, tone: "warn", label: "Stream silent" };
    }
    case "silence_recovered": {
      return { icon: Volume2, tone: "ok", label: "Stream recovered" };
    }
    case "rate_limited": {
      return { icon: Gauge, tone: "warn", label: "Rate limited" };
    }
    case "span_cap_exceeded": {
      return { icon: Layers, tone: "warn", label: "Span cap exceeded" };
    }
    case "span_bytes_exceeded": {
      return { icon: Layers, tone: "warn", label: "Span payload too large" };
    }
    case "service_cap_exceeded": {
      return { icon: Network, tone: "warn", label: "Service cap exceeded" };
    }
    case "operation_cap_exceeded": {
      return { icon: Route, tone: "warn", label: "Operation cap exceeded" };
    }
  }
}
