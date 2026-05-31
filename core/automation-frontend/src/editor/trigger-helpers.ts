import type { Trigger } from "@checkstack/automation-common";
import { deriveTriggerId } from "@checkstack/automation-common";

/**
 * Auto-id helpers for triggers, mirroring `action-helpers` for actions.
 *
 * A trigger's `id` is what `trigger.id` resolves to at runtime and the
 * discriminator that distinguishes triggers in templates / scripts - including
 * two triggers subscribed to the same `event`. The editor assigns a unique,
 * log-friendly default so the operator never has to, but can rename it.
 */

/** Base id for a trigger: derived from its event id, falling back to `trigger`. */
function suggestTriggerIdBase(trigger: Trigger): string {
  return deriveTriggerId(trigger.event) || "trigger";
}

/** Collect every assigned (non-empty) trigger id into a set. */
export function collectTriggerIds(
  triggers: Trigger[],
  into: Set<string> = new Set(),
): Set<string> {
  for (const trigger of triggers) {
    if (typeof trigger.id === "string" && trigger.id.length > 0) {
      into.add(trigger.id);
    }
  }
  return into;
}

/** Make `base` unique against `taken`, appending `_2`, `_3`, ... as needed. */
function uniqueTriggerId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/**
 * A single identifier-safe, unique default id for `trigger`, deduped against
 * `taken`. Used to seed a new trigger and to re-fill the Id field when the
 * operator clears it.
 */
export function defaultTriggerId(
  trigger: Trigger,
  taken: Set<string>,
): string {
  return uniqueTriggerId(suggestTriggerIdBase(trigger), taken);
}

/**
 * Build a fresh trigger subscribed to `event` with a unique, log-friendly
 * default `id` (deduped against `taken`). Used by the trigger type picker so a
 * newly-added trigger is immediately referenceable as `trigger.id` rather than
 * appearing blank.
 */
export function makeTrigger({
  event,
  taken,
}: {
  event: string;
  taken: Set<string>;
}): Trigger {
  const base: Trigger = { event };
  return { ...base, id: defaultTriggerId(base, taken) };
}

/**
 * Return a copy of `triggers` with a stable, unique id assigned to every
 * trigger that does not already have one. Existing ids are preserved and seed
 * the uniqueness set. Used when seeding the starter automation so the id is
 * shown immediately rather than appearing blank.
 */
export function assignDefaultTriggerIds(
  triggers: Trigger[],
  taken: Set<string> = collectTriggerIds(triggers),
): Trigger[] {
  return triggers.map((trigger) => {
    if (typeof trigger.id === "string" && trigger.id.length > 0) return trigger;
    const id = uniqueTriggerId(suggestTriggerIdBase(trigger), taken);
    taken.add(id);
    return { ...trigger, id };
  });
}
