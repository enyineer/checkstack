/**
 * One-time migration: rewrite legacy `healthcheck.flapping_detected` triggers
 * onto the generic windowed-count gate.
 *
 * The pre-derived `flapping_detected` trigger (+ its `{ transitions,
 * windowMinutes }` config) was removed. Flapping is now expressed as a window
 * over the raw `healthcheck.system_health_changed` change event:
 *
 *   event:  healthcheck.flapping_detected
 *   config: { transitions, windowMinutes }
 *      ↓
 *   event:  healthcheck.system_health_changed
 *   filter: trigger.payload.newStatus != "healthy"
 *   window: { count: transitions ?? 3, minutes: windowMinutes ?? 60, refire: "once" }
 *
 * Targets USER-created automations only — the seeded `auto-incident:*` rows
 * were already deleted (migration 0008). Idempotent: an automation whose
 * triggers no longer reference the legacy event is left untouched.
 *
 * Safe-option note on a PRE-EXISTING filter: a legacy flapping trigger could
 * (rarely) already carry an operator `filter`. The unhealthy-transition filter
 * is the load-bearing semantic of the new flapping shape, so we REPLACE any
 * pre-existing filter with the canonical one rather than silently AND-combining
 * (which could change behaviour in surprising ways). This is logged per row so
 * an operator can re-add a bespoke clause if they had one.
 */
import { eq } from "drizzle-orm";
import type { Logger, SafeDatabase } from "@checkstack/backend-api";

import * as schema from "../schema";

type Db = SafeDatabase<typeof schema>;

/** Legacy + new event ids (string-compared against stored `trigger.event`). */
export const LEGACY_FLAPPING_EVENT = "healthcheck.flapping_detected";
export const HEALTH_CHANGED_EVENT = "healthcheck.system_health_changed";

/** Canonical filter for the windowed flapping shape (unhealthy transitions). */
export const FLAPPING_FILTER = 'trigger.payload.newStatus != "healthy"';

/** Defaults applied when a legacy trigger carried no / partial config. */
export const DEFAULT_FLAPPING_COUNT = 3;
export const DEFAULT_FLAPPING_MINUTES = 60;

interface RewriteOutcome {
  /** The (possibly) rewritten definition. */
  definition: Record<string, unknown>;
  /** Number of flapping triggers rewritten in this definition. */
  rewritten: number;
  /** True if any rewritten trigger had a pre-existing filter we replaced. */
  replacedFilter: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readPositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : fallback;
}

/**
 * Rewrite every legacy `flapping_detected` trigger in a stored automation
 * definition. Pure — no I/O — so the mapping (config → window, defaults,
 * filter replacement) is unit-testable in isolation. Returns the new
 * definition plus counters; `rewritten === 0` means "leave the row untouched".
 */
export function rewriteFlappingTriggers(
  definition: Record<string, unknown>,
): RewriteOutcome {
  const triggers = definition["triggers"];
  if (!Array.isArray(triggers)) {
    return { definition, rewritten: 0, replacedFilter: false };
  }

  let rewritten = 0;
  let replacedFilter = false;

  const nextTriggers = triggers.map((raw) => {
    const trigger = asRecord(raw);
    if (!trigger || trigger["event"] !== LEGACY_FLAPPING_EVENT) return raw;

    const config = asRecord(trigger["config"]);
    const count = readPositiveInt(config?.["transitions"], DEFAULT_FLAPPING_COUNT);
    const minutes = readPositiveInt(
      config?.["windowMinutes"],
      DEFAULT_FLAPPING_MINUTES,
    );

    if (typeof trigger["filter"] === "string") replacedFilter = true;
    rewritten += 1;

    // Drop `config`; set the new event + canonical filter + window. Preserve
    // any other fields the operator set (id, for, etc.).
    const { config: _dropped, ...rest } = trigger;
    void _dropped;
    return {
      ...rest,
      event: HEALTH_CHANGED_EVENT,
      filter: FLAPPING_FILTER,
      window: { count, minutes, refire: "once" },
    };
  });

  if (rewritten === 0) {
    return { definition, rewritten: 0, replacedFilter: false };
  }
  return {
    definition: { ...definition, triggers: nextTriggers },
    rewritten,
    replacedFilter,
  };
}

export interface FlappingMigrationResult {
  /** Automations scanned. */
  scanned: number;
  /** Automations whose definition was rewritten + persisted. */
  migrated: number;
  /** Total flapping triggers rewritten across all rows. */
  triggersRewritten: number;
}

/**
 * Scan every automation and rewrite legacy flapping triggers. Idempotent:
 * rows with no flapping trigger are skipped; rows already migrated have no
 * `flapping_detected` event and are skipped too. Safe to run on every boot.
 *
 * After the rewrite, logs a WARNING if any enabled automation still references
 * the legacy event (should never happen post-rewrite — a leftover indicates a
 * definition the migration couldn't parse).
 */
export async function runFlappingAutomationMigration(args: {
  db: Db;
  logger: Logger;
}): Promise<FlappingMigrationResult> {
  const { db, logger } = args;

  const rows = await db
    .select({
      id: schema.automations.id,
      name: schema.automations.name,
      status: schema.automations.status,
      definition: schema.automations.definition,
    })
    .from(schema.automations);

  let migrated = 0;
  let triggersRewritten = 0;
  // Enabled rows that STILL reference the dead event after the rewrite pass —
  // i.e. the rewrite couldn't convert them (unparseable definition). These
  // would never fire again, so they get a per-boot warning.
  const leftover: string[] = [];

  for (const row of rows) {
    const outcome = rewriteFlappingTriggers(row.definition);
    if (outcome.rewritten === 0) {
      // Untouched: flag it only if it (still) points at the dead event while
      // enabled — the rewrite found nothing to convert there.
      const triggers = row.definition["triggers"];
      if (
        row.status === "enabled" &&
        Array.isArray(triggers) &&
        triggers.some((t) => asRecord(t)?.["event"] === LEGACY_FLAPPING_EVENT)
      ) {
        leftover.push(row.id);
      }
      continue;
    }

    await db
      .update(schema.automations)
      .set({ definition: outcome.definition, updatedAt: new Date() })
      .where(eq(schema.automations.id, row.id));

    migrated += 1;
    triggersRewritten += outcome.rewritten;
    logger.info(
      `flapping migration: rewrote ${outcome.rewritten} flapping trigger(s) on automation ${row.id} (${row.name}) → windowed system_health_changed${
        outcome.replacedFilter
          ? "; a pre-existing trigger filter was replaced with the canonical unhealthy-transition filter"
          : ""
      }`,
    );
  }

  if (leftover.length > 0) {
    logger.warn(
      `flapping migration: ${leftover.length} enabled automation(s) still reference the removed "${LEGACY_FLAPPING_EVENT}" event after migration and will not fire: ${leftover.join(
        ", ",
      )}`,
    );
  }

  if (migrated > 0) {
    logger.debug(
      `flapping migration: migrated ${migrated} automation(s) (${triggersRewritten} trigger(s))`,
    );
  }
  return { scanned: rows.length, migrated, triggersRewritten };
}
