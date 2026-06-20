/**
 * Pure, DOM-free display helpers for the notification-frontend premium
 * surfaces (inbox rows, delivery attempts, channel cards).
 *
 * These derive the visual classification (status-triad tone, formatted
 * figures) shown by the cards and tables. They live here so the branch
 * logic can be unit-tested without rendering React or importing
 * `@checkstack/ui`, mirroring `slo-frontend`'s `sloDisplay.logic.ts`.
 */

import type { Notification } from "@checkstack/notification-common";

/** The colorblind-safe status-triad stem a surface maps onto. */
export type StatusTone = "ok" | "warn" | "down" | "neutral";

/** Per-tone class sets for a status pill, its dot, and a left accent stripe. */
export interface ToneStyle {
  pill: string;
  dot: string;
  accent: string;
}

/**
 * Tone -> class sets. Spelled out as full literal strings (not interpolated)
 * so Tailwind's JIT keeps them, driven by the colorblind-safe status triad.
 * `neutral` is the recede tone for read/disabled rows.
 */
export const toneStyles: Record<StatusTone, ToneStyle> = {
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

/** Human label shown on a notification importance pill, by importance. */
export interface ImportancePresentation {
  label: string;
  tone: StatusTone;
}

/**
 * Map a notification's importance to its status-triad tone and label.
 * Preserves the existing semantics: critical -> down, warning -> warn,
 * everything else (info) -> ok. The labels match the prior Badge copy
 * ("Critical" / "Warning" / "Info") verbatim.
 */
export function presentImportance({
  importance,
}: {
  importance: Notification["importance"];
}): ImportancePresentation {
  switch (importance) {
    case "critical": {
      return { label: "Critical", tone: "down" };
    }
    case "warning": {
      return { label: "Warning", tone: "warn" };
    }
    default: {
      return { label: "Info", tone: "ok" };
    }
  }
}

/**
 * Resolve the left accent-stripe tone for an inbox row. An unread row keeps
 * its importance tone so it stays scannable; a read row recedes to neutral
 * so the eye lands on what still needs attention.
 */
export function inboxRowAccentTone({
  importance,
  isRead,
}: {
  importance: Notification["importance"];
  isRead: boolean;
}): StatusTone {
  if (isRead) return "neutral";
  return presentImportance({ importance }).tone;
}

export interface DeliveryAttemptLike {
  status: "success" | "failure";
}

/**
 * Count successes and failures across the already-fetched attempts on the
 * current page. Derived purely from the page slice (no new query), so the
 * figures describe "this page" exactly as the table below does.
 */
export function summarizeDeliveryAttempts({
  attempts,
}: {
  attempts: ReadonlyArray<DeliveryAttemptLike>;
}): { successes: number; failures: number } {
  let successes = 0;
  let failures = 0;
  for (const attempt of attempts) {
    if (attempt.status === "success") {
      successes += 1;
    } else {
      failures += 1;
    }
  }
  return { successes, failures };
}
