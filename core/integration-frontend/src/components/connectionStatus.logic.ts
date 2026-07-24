/**
 * Pure, DOM-free display helpers for the connection-roster status indicator.
 *
 * A connection's status comes from a manual "Test connection" run. Until a
 * test has run the status is `unknown` (idle), a successful test is `ok`, and a
 * failed test is `down`. These helpers map that triad onto the colorblind-safe
 * status tones and the per-tone Tailwind class sets shared by the desktop table
 * cell and the mobile card accent stripe. Kept here so the branch logic can be
 * unit-tested without rendering React.
 */

import {
  neutralToneStyle, pillToneStyles } from "@checkstack/ui";

/** The colorblind-safe status-triad stem a test result maps onto. */
export type ConnectionTone = "ok" | "down" | "unknown";

export interface ConnectionStatusPresentation {
  label: string;
  tone: ConnectionTone;
}

/**
 * Resolve a connection's status presentation from its last test result. An
 * absent result is the resting `unknown` state ("Untested"); a result maps to
 * `ok` ("Connected") or `down` ("Failed"). The "Connected"/"Failed" labels are
 * test-visible and must not change.
 */
export function presentConnectionStatus({
  testResult,
}: {
  testResult: { success: boolean; message?: string } | undefined;
}): ConnectionStatusPresentation {
  if (!testResult) return { label: "Untested", tone: "unknown" };
  if (testResult.success) return { label: "Connected", tone: "ok" };
  return { label: "Failed", tone: "down" };
}

/** Per-tone class sets for the status pill, its dot, and the card accent. */
export interface ConnectionToneStyles {
  pill: string;
  dot: string;
  accent: string;
}

/**
 * Per-tone class sets, taken from the shared `pillToneStyles` table wherever a
 * status hue applies.
 */
const toneStyles: Record<ConnectionTone, ConnectionToneStyles> = {
  ok: pillToneStyles.ok,
  down: pillToneStyles.down,
  // An untested connection is not a status the operator should read as bad, so
  // it renders as the ABSENCE of a hue (the muted classes the shared
  // `StatusPill` uses for `tone="neutral"`) rather than the shared table's
  // `unknown` grey - an untested connection carries no signal at all.
  unknown: neutralToneStyle,
};

/** Resolve the Tailwind class set for a given {@link ConnectionTone}. */
export function connectionToneStyles({
  tone,
}: {
  tone: ConnectionTone;
}): ConnectionToneStyles {
  return toneStyles[tone];
}
