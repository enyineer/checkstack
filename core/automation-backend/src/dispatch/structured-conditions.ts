/**
 * Evaluators for the structured condition variants (Wave 2 Phase 16):
 * `numeric_state`, `time`, and `state`. All pure + synchronous; they read
 * the pre-resolved scope (`health.*`) and compute a FRESH `now` per call
 * (constraint 7 — never the frozen scope `now`).
 */
import {
  evaluate,
  parseCondition,
  type FilterRegistry,
  type TemplateContext,
} from "@checkstack/template-engine";
import {
  durationToMs,
  type NumericStateCondition,
  type StateCondition,
  type TimeCondition,
} from "@checkstack/automation-common";

import { matchesThreshold, toNumberOrNull } from "./numeric";

/**
 * `numeric_state`: resolve `value` (literal number, or a template/path
 * string rendered against scope) and compare to `above` / `below`.
 */
export function evaluateNumericStateCondition(
  condition: NumericStateCondition,
  context: TemplateContext,
  filters: FilterRegistry,
): boolean {
  const { value, above, below } = condition.numeric_state;
  let resolved: number | null;
  if (typeof value === "number") {
    resolved = Number.isFinite(value) ? value : null;
  } else {
    // Treat the string as a template expression so `{{ }}`-free paths
    // (e.g. `health.system.p95_latency_ms`) resolve to the raw value.
    const raw = evaluate(parseCondition(value), context, { filters });
    resolved = toNumberOrNull(raw);
  }
  return matchesThreshold({ value: resolved, above, below });
}

/**
 * `time`: gate on time-of-day / weekday in a given timezone. Uses a fresh
 * `now` (passed in) and `Intl` to resolve wall-clock fields in `timezone`.
 */
export function evaluateTimeCondition(
  condition: TimeCondition,
  now: Date,
): boolean {
  const { after, before, weekday, timezone } = condition.time;
  const tz = timezone ?? "UTC";

  const { minutes, weekday: dow } = wallClock(now, tz);

  if (weekday && !weekday.includes(dow)) return false;

  const afterMin = after ? hhmmToMinutes(after) : undefined;
  const beforeMin = before ? hhmmToMinutes(before) : undefined;

  if (afterMin !== undefined && beforeMin !== undefined) {
    if (afterMin <= beforeMin) {
      // Same-day window: [after, before).
      return minutes >= afterMin && minutes < beforeMin;
    }
    // Overnight window wrapping midnight (e.g. 22:00 → 06:00): match when
    // at/after `after` OR before `before`.
    return minutes >= afterMin || minutes < beforeMin;
  }
  if (afterMin !== undefined && minutes < afterMin) return false;
  if (beforeMin !== undefined && minutes >= beforeMin) return false;
  return true;
}

/**
 * `state`: read the entity's pre-resolved health from scope and check it
 * is in `status` for at least `for` (from `in_status_for_ms`). No timer —
 * it reads the duration the provider already computed.
 */
export function evaluateStateCondition(
  condition: StateCondition,
  context: TemplateContext,
): boolean {
  const { entity, status, for: dwell } = condition.state;
  const health = (context as Record<string, unknown>).health;
  if (!isRecord(health)) return false;
  const systems = isRecord(health.systems) ? health.systems : undefined;
  const entityState = systems && isRecord(systems[entity]) ? systems[entity] : undefined;
  if (!entityState) return false;

  if (entityState.status !== status) return false;

  if (dwell) {
    const requiredMs = durationToMs(dwell);
    if (requiredMs === null) return false;
    const heldMs = toNumberOrNull(entityState.in_status_for_ms) ?? 0;
    if (heldMs < requiredMs) return false;
  }
  return true;
}

// ─── helpers ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Resolve wall-clock minutes-since-midnight + weekday (0 = Sunday) for a
 * given instant in a given IANA timezone, using Intl (no external tz lib).
 */
function wallClock(
  now: Date,
  timezone: string,
): { minutes: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  // hour can come back as "24" at midnight in some engines — normalise.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[get("weekday")] ?? 0;
  return { minutes: hour * 60 + minute, weekday };
}
