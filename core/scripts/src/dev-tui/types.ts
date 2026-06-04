import { z } from "zod";
import type { LogLevel } from "./log-level.ts";

/**
 * Stable identifier for one supervised process. Used as the alert source tag
 * and the sidebar key, so it must be unique per process.
 */
export const processIdSchema = z.enum(["deps", "backend", "frontend"]);
export type ProcessId = z.infer<typeof processIdSchema>;

/**
 * Lifecycle status of a supervised process, surfaced as a colored status dot.
 */
export const processStatusSchema = z.enum([
  "starting",
  "ready",
  "errored",
  "stopped",
]);
export type ProcessStatus = z.infer<typeof processStatusSchema>;

/** A single aggregated alert (a warn/error line from any process). */
export interface AlertEntry {
  readonly source: ProcessId;
  readonly level: LogLevel;
  readonly text: string;
  /** Monotonic sequence number used for stable newest-first ordering. */
  readonly seq: number;
}
