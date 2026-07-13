import type { SeverityBand } from "@checkstack/logstream-common";
import type { ImportantEventType } from "@checkstack/logstream-common";
import type { StatusTone } from "@checkstack/ui";
import {
  Bug,
  CircleAlert,
  Info,
  OctagonAlert,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Volume2,
  VolumeX,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

/**
 * Map a severity band to the platform's shared status tone vocabulary (used by
 * `StatusBadge`, tile tones and row accents). Pure and unit-tested so the
 * viewer, patterns table and important-events timeline all colour severity the
 * same way.
 *
 * - `fatal` / `error` -> `error`
 * - `warn` -> `warn`
 * - `info` -> `info`
 * - `debug` / `trace` -> `neutral`
 */
export function severityBandToTone(band: SeverityBand): StatusTone {
  switch (band) {
    case "fatal":
    case "error": {
      return "error";
    }
    case "warn": {
      return "warn";
    }
    case "info": {
      return "info";
    }
    case "debug":
    case "trace": {
      return "neutral";
    }
  }
}

/** A lucide icon per severity band, for the severity `StatusBadge`. */
export function severityBandIcon(band: SeverityBand): LucideIcon {
  switch (band) {
    case "fatal": {
      return OctagonAlert;
    }
    case "error": {
      return CircleAlert;
    }
    case "warn": {
      return TriangleAlert;
    }
    case "info": {
      return Info;
    }
    case "debug":
    case "trace": {
      return Bug;
    }
  }
}

/** Human label for a band (capitalised), for badges and legends. */
export function severityBandLabel(band: SeverityBand): string {
  return band.charAt(0).toUpperCase() + band.slice(1);
}

/**
 * Map the `StatusUpdateTimeline`'s status tone to the `StackTone` used by the
 * severity `StackedTimeline` (`ok | warn | down | unknown`). Severity bands
 * fold into three visual stacks so the chart stays legible.
 */
export function severityBandToStackTone(
  band: SeverityBand,
): "ok" | "warn" | "down" | "unknown" {
  switch (band) {
    case "fatal":
    case "error": {
      return "down";
    }
    case "warn": {
      return "warn";
    }
    case "info": {
      return "ok";
    }
    case "debug":
    case "trace": {
      return "unknown";
    }
  }
}

export interface ImportantEventVisual {
  icon: LucideIcon;
  tone: StatusTone;
  label: string;
}

/**
 * Icon + tone + label for an important-event type, so the viewer's timeline
 * renders each event kind with a consistent, type-specific glyph.
 */
export function importantEventVisual(
  type: ImportantEventType,
): ImportantEventVisual {
  switch (type) {
    case "new_pattern": {
      return { icon: Sparkles, tone: "info", label: "New pattern" };
    }
    case "spike": {
      return { icon: TrendingUp, tone: "error", label: "Error spike" };
    }
    case "silence": {
      return { icon: VolumeX, tone: "warn", label: "Stream silent" };
    }
    case "silence_recovered": {
      return { icon: Volume2, tone: "ok", label: "Stream recovered" };
    }
    case "threshold": {
      return { icon: Waypoints, tone: "warn", label: "Threshold" };
    }
  }
}
