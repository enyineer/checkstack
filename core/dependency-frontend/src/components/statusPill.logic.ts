/**
 * Pure, DOM-free helpers for mapping dependency status/impact values onto the
 * colorblind-safe status triad (ok / warn / down) plus a neutral fallback.
 *
 * These keep the premium status-pill and accent-stripe styling DRY across the
 * dependency alert banner and the upstream/downstream editor rows. They only
 * return Tailwind class strings and a tone token, never DOM, so they stay free
 * of any `@checkstack/ui` runtime dependency and are trivially unit-tested.
 */

import type { DerivedState, ImpactType } from "@checkstack/dependency-common";

/** Tone token for the triad plus a neutral fallback. */
export type StatusTone = "ok" | "warn" | "down" | "neutral";

/**
 * Per-tone class sets for a status pill (background + text + dot) and a left
 * accent stripe. Full literal strings so Tailwind's JIT keeps them.
 */
export const toneStyles: Record<
  StatusTone,
  { pill: string; dot: string; accent: string }
> = {
  ok: {
    pill: "bg-status-ok/10 text-status-ok",
    dot: "bg-status-ok",
    accent: "bg-status-ok",
  },
  warn: {
    pill: "bg-status-warn/10 text-status-warn",
    dot: "bg-status-warn",
    accent: "bg-status-warn",
  },
  down: {
    pill: "bg-status-down/10 text-status-down",
    dot: "bg-status-down",
    accent: "bg-status-down",
  },
  neutral: {
    pill: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground",
    accent: "bg-border",
  },
};

/**
 * Map a free-form upstream `ownStatus` string onto a triad tone. Anything that
 * reads as healthy/operational/ok/up is `ok`; degraded/warn-like is `warn`;
 * down/critical/error/unhealthy is `down`; everything else is `neutral`.
 */
export function ownStatusTone({ ownStatus }: { ownStatus: string }): StatusTone {
  const value = ownStatus.toLowerCase();
  if (
    value === "down" ||
    value === "critical" ||
    value === "error" ||
    value === "unhealthy"
  ) {
    return "down";
  }
  if (value === "degraded" || value === "warn" || value === "warning") {
    return "warn";
  }
  if (
    value === "operational" ||
    value === "ok" ||
    value === "healthy" ||
    value === "up"
  ) {
    return "ok";
  }
  return "neutral";
}

/** Accent-stripe tone for a derived dependency state. */
export function derivedStateTone({ state }: { state: DerivedState }): StatusTone {
  switch (state) {
    case "down": {
      return "down";
    }
    case "degraded": {
      return "warn";
    }
    default: {
      return "neutral";
    }
  }
}

/** Accent-stripe tone for a dependency impact type (row-edge encoding). */
export function impactTypeTone({
  impactType,
}: {
  impactType: ImpactType;
}): StatusTone {
  switch (impactType) {
    case "critical": {
      return "down";
    }
    case "degraded": {
      return "warn";
    }
    default: {
      return "neutral";
    }
  }
}
