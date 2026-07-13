import type { ImportantEventType } from "@checkstack/metricstream-common";
import type { StatusTone } from "@checkstack/ui";
import {
  Layers,
  ServerCrash,
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
 * Icon + tone + label for a metric-stream important-event type, so the viewer's
 * timeline renders each event kind with a consistent, type-specific glyph. Pure
 * and unit-tested so a new event type can never silently render with no visual.
 *
 * - `series_cap`: the cardinality cap was hit and new series are being DROPPED
 *   (a capacity warning, not an outage).
 * - `scrape_failing`: a Prometheus scrape target has failed repeatedly.
 * - `silence` / `silence_recovered`: the stream stopped / resumed receiving.
 */
export function importantEventVisual(
  type: ImportantEventType,
): ImportantEventVisual {
  switch (type) {
    case "series_cap": {
      return { icon: Layers, tone: "warn", label: "Series cap reached" };
    }
    case "scrape_failing": {
      return { icon: ServerCrash, tone: "error", label: "Scrape failing" };
    }
    case "silence": {
      return { icon: VolumeX, tone: "warn", label: "Stream silent" };
    }
    case "silence_recovered": {
      return { icon: Volume2, tone: "ok", label: "Stream recovered" };
    }
  }
}
