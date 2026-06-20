import type { InstallEventStatus } from "@checkstack/pluginmanager-common";

/**
 * Visual tones for a plugin lifecycle event, mapped onto the colorblind-safe
 * status triad. A "started" event is in-flight (unknown), "succeeded" is ok,
 * and "failed" is down. Status is always multi-encoded (icon + dot + text),
 * never color alone.
 */
export type EventTone = "ok" | "down" | "unknown";

export interface EventToneClasses {
  pill: string;
  dot: string;
  accent: string;
}

/**
 * Per-tone class sets for the event status pill, dot, and accent stripe.
 * Spelled out as full literal strings so Tailwind's JIT keeps them.
 */
export const EVENT_TONE_STYLES: Record<EventTone, EventToneClasses> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
  },
  down: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
  },
  unknown: {
    pill: "bg-status-unknown/10 text-status-unknown",
    dot: "bg-status-unknown",
    accent: "bg-status-unknown",
  },
};

/**
 * Map a lifecycle event status onto a triad tone. Pure logic so it can be
 * unit tested independently of rendering.
 */
export function eventTone({ status }: { status: InstallEventStatus }): EventTone {
  switch (status) {
    case "succeeded": {
      return "ok";
    }
    case "failed": {
      return "down";
    }
    default: {
      return "unknown";
    }
  }
}
