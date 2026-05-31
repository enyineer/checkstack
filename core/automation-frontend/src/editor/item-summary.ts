/**
 * Pure summary-string derivation for the collapsed item cards (actions,
 * triggers, conditions) in the visual editor. Each helper turns a piece of
 * the definition into a single compact line shown under the card title in
 * its collapsed Home-Assistant-style summary row.
 *
 * Kept free of any React / `@checkstack/ui` imports so the logic is
 * unit-testable under bun (the UI barrel drags Monaco's vscode-only modules,
 * which break bun's test runner).
 */
import type {
  ActionInput,
  ChooseInput,
  ConditionInput,
  DelayInput,
  ParallelInput,
  ProviderAction,
  RepeatInput,
  SequenceInput,
  StopInput,
  Trigger,
  VariablesInput,
  WaitForTriggerInput,
  WaitUntilInput,
} from "@checkstack/automation-common";
import { actionKindOf } from "./action-helpers";
import { kindOf } from "./condition-kind";

/** Collapse internal whitespace and clip to `max` chars with an ellipsis. */
function clip(text: string, max = 80): string {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

/** Local (post-dot) name of a fully-qualified id, e.g. `plugin.foo` -> `foo`. */
function localName(qualified: string): string {
  return qualified.includes(".")
    ? qualified.slice(qualified.lastIndexOf(".") + 1)
    : qualified;
}

/**
 * One-line summary for a trigger's collapsed card: the event id, plus a hint
 * of the gating filter / dwell window when set. Returns `undefined` when there
 * is nothing meaningful to show beyond the title (no event picked yet).
 */
export function summarizeTrigger(trigger: Trigger): string | undefined {
  const parts: string[] = [];
  if (trigger.event) parts.push(trigger.event);
  if (trigger.filter) parts.push(`if ${trigger.filter}`);
  if (trigger.for) parts.push("with dwell");
  if (trigger.window) {
    const rate = `${trigger.window.count}× / ${trigger.window.minutes}m`;
    parts.push(
      trigger.window.partitionBy
        ? `${rate} by ${trigger.window.partitionBy}`
        : rate,
    );
  }
  if (parts.length === 0) return undefined;
  return clip(parts.join(" · "));
}

/** First few stops of a human time string for a duration-ish value. */
function summarizeDelay(value: DelayInput): string {
  if ("template" in value.delay) {
    return value.delay.template
      ? `delay ${value.delay.template}`
      : "delay (template)";
  }
  return `delay ${value.delay.seconds}s`;
}

function summarizeStop(value: StopInput): string {
  const reason = value.stop.reason ? `: ${value.stop.reason}` : "";
  return `${value.stop.error ? "fail run" : "stop run"}${reason}`;
}

function summarizeVariables(value: VariablesInput): string {
  const keys = Object.keys(value.variables);
  if (keys.length === 0) return "no variables";
  return `set ${keys.join(", ")}`;
}

function summarizeChoose(value: ChooseInput): string {
  const branches = value.choose.length;
  const elseHint = value.else && value.else.length > 0 ? " + else" : "";
  return `${branches} branch${branches === 1 ? "" : "es"}${elseHint}`;
}

function summarizeParallel(value: ParallelInput): string {
  const n = value.parallel.length;
  return `${n} branch${n === 1 ? "" : "es"}`;
}

function summarizeSequence(value: SequenceInput): string {
  const n = value.sequence.length;
  return `${n} step${n === 1 ? "" : "s"}`;
}

function summarizeRepeat(value: RepeatInput): string {
  const mode = value.repeat;
  if ("count" in mode) return `count ${mode.count}`;
  if ("for_each" in mode) return `for each ${mode.for_each || "…"}`;
  if ("while" in mode) return `while ${mode.while || "…"}`;
  return `until ${mode.until || "…"}`;
}

function summarizeWaitForTrigger(value: WaitForTriggerInput): string {
  const event = value.wait_for_trigger.event || "any event";
  return `wait for ${event}`;
}

function summarizeWaitUntil(value: WaitUntilInput): string {
  return `wait until ${summarizeCondition(value.wait_until.condition)}`;
}

/**
 * One-line summary for an action's collapsed card. Provider actions surface
 * the local action name; structural kinds surface a compact shape hint
 * (branch / step counts, repeat mode, delay length, …). Returns `undefined`
 * when nothing beyond the kind label is meaningful.
 */
export function summarizeAction(action: ActionInput): string | undefined {
  const kind = actionKindOf(action);
  switch (kind) {
    case "action": {
      const provider = action as ProviderAction;
      if (!provider.action) return undefined;
      return clip(localName(provider.action));
    }
    case "choose": {
      return clip(summarizeChoose(action as ChooseInput));
    }
    case "parallel": {
      return clip(summarizeParallel(action as ParallelInput));
    }
    case "sequence": {
      return clip(summarizeSequence(action as SequenceInput));
    }
    case "repeat": {
      return clip(summarizeRepeat(action as RepeatInput));
    }
    case "delay": {
      return clip(summarizeDelay(action as DelayInput));
    }
    case "stop": {
      return clip(summarizeStop(action as StopInput));
    }
    case "variables": {
      return clip(summarizeVariables(action as VariablesInput));
    }
    case "wait_for_trigger": {
      return clip(summarizeWaitForTrigger(action as WaitForTriggerInput));
    }
    case "wait_until": {
      return clip(summarizeWaitUntil(action as WaitUntilInput));
    }
    case "condition": {
      return undefined;
    }
  }
}

/**
 * One-line summary for a condition's collapsed card. Expressions show their
 * (clipped) source; structured kinds show a readable shape; combinators show
 * a child count. Always returns a non-empty string (a bare empty expression
 * reads as "empty expression").
 */
export function summarizeCondition(condition: ConditionInput): string {
  const kind = kindOf(condition);
  switch (kind) {
    case "expr": {
      const expr = typeof condition === "string" ? condition.trim() : "";
      return expr ? clip(expr) : "empty expression";
    }
    case "and": {
      const n = (condition as { and: ConditionInput[] }).and.length;
      return `all of ${n}`;
    }
    case "or": {
      const n = (condition as { or: ConditionInput[] }).or.length;
      return `any of ${n}`;
    }
    case "not": {
      return "not (…)";
    }
    case "numeric_state": {
      const ns = (condition as { numeric_state: { value: string | number; above?: number; below?: number } })
        .numeric_state;
      const bounds: string[] = [];
      if (ns.above !== undefined) bounds.push(`> ${ns.above}`);
      if (ns.below !== undefined) bounds.push(`< ${ns.below}`);
      return clip(`${ns.value} ${bounds.join(" and ")}`.trim());
    }
    case "time": {
      const t = (condition as { time: { after?: string; before?: string } })
        .time;
      const range = [t.after, t.before].filter(Boolean).join(" – ");
      return range ? `time ${range}` : "time of day";
    }
    case "state": {
      const s = (condition as { state: { entity: string; status: string } })
        .state;
      return clip(`${s.entity || "system"} is ${s.status}`);
    }
  }
}
