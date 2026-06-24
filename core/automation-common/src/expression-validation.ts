/**
 * Expression-field syntax validation.
 *
 * The automation data model has two distinct value flavours and authors keep
 * confusing them:
 *
 *   - **Template fields** (every action `config` string, a `delay`/`repeat`
 *     duration template, `variables` values) are rendered through the template
 *     engine, so a field reference MUST be wrapped in `{{ ... }}`.
 *   - **Expression fields** (`when`, the top-level `conditions`, a `condition`
 *     guard, `wait_until.condition`, a trigger/`wait_for_trigger` `filter`,
 *     `window.partitionBy`, `repeat.for_each` / `while` / `until`, and a
 *     `numeric_state.value` string) are parsed DIRECTLY as a bare expression
 *     and reference fields WITHOUT `{{ ... }}`.
 *
 * Wrapping an expression in `{{ ... }}` is always a bug: the engine wraps the
 * source as `{{<source>}}` before tokenizing, so a `{{ x }}` value becomes
 * `{{{{ x }}}}` and throws a parse error at dispatch time — long after the
 * author saved it. This walker flags that mistake up front so it blocks the
 * save instead of failing at run time.
 *
 * Returned `path`s are relative to the automation DEFINITION (e.g.
 * `["actions", 0, "choose", 0, "when"]`), so they slot straight into a Zod
 * `superRefine` `ctx.addIssue({ path })` and into the editor's issue list.
 */
import type {
  ActionInput,
  AutomationDefinition,
  ConditionInput,
} from "./schemas";

/**
 * Matches either template delimiter. An expression must contain neither — both
 * `{{` and `}}` are template-engine syntax that has no place in a bare
 * expression.
 */
const TEMPLATE_DELIMITER_RE = /\{\{|\}\}/;

/**
 * The single canonical message for "you put a `{{ }}` template into an
 * expression field". Reused by the schema refinement and any direct caller so
 * the editor, API, and tests all surface identical wording.
 */
export const EXPRESSION_TEMPLATE_DELIMITER_MESSAGE =
  "Expression fields reference values directly and must not be wrapped in {{ }} template delimiters. " +
  'Remove the braces — e.g. write `artifacts.find.issue_search.found != true`, not `{{ ... }}`.';

export interface ExpressionIssue {
  path: Array<string | number>;
  message: string;
}

/**
 * Flag a single expression string when it contains template delimiters.
 */
function flagExpression(
  value: string,
  path: Array<string | number>,
  issues: ExpressionIssue[],
): void {
  if (TEMPLATE_DELIMITER_RE.test(value)) {
    issues.push({ path, message: EXPRESSION_TEMPLATE_DELIMITER_MESSAGE });
  }
}

/**
 * Walk a (possibly nested) condition, flagging every bare-expression string
 * leaf. The combinator branches (`and` / `or` / `not`) recurse; a
 * `numeric_state.value` string is itself a bare expression; `time` / `state`
 * carry no free-form expression.
 */
function walkCondition(
  condition: ConditionInput,
  path: Array<string | number>,
  issues: ExpressionIssue[],
): void {
  if (typeof condition === "string") {
    flagExpression(condition, path, issues);
    return;
  }
  if ("and" in condition) {
    for (const [i, c] of condition.and.entries()) {
      walkCondition(c, [...path, "and", i], issues);
    }
    return;
  }
  if ("or" in condition) {
    for (const [i, c] of condition.or.entries()) {
      walkCondition(c, [...path, "or", i], issues);
    }
    return;
  }
  if ("not" in condition) {
    walkCondition(condition.not, [...path, "not"], issues);
    return;
  }
  if ("numeric_state" in condition) {
    const { value } = condition.numeric_state;
    if (typeof value === "string") {
      flagExpression(value, [...path, "numeric_state", "value"], issues);
    }
  }
  // `time` / `state` variants carry no bare-expression string.
}

/**
 * Walk a single action, flagging expression-field strings and recursing into
 * any nested action lists.
 */
function walkAction(
  action: ActionInput,
  path: Array<string | number>,
  issues: ExpressionIssue[],
): void {
  // Provider action: its `config` is template fields, not expressions.
  if ("action" in action) return;

  if ("choose" in action) {
    for (const [i, branch] of action.choose.entries()) {
      walkCondition(branch.when, [...path, "choose", i, "when"], issues);
      walkActions(branch.sequence, [...path, "choose", i, "sequence"], issues);
    }
    if (action.else) walkActions(action.else, [...path, "else"], issues);
    return;
  }

  if ("condition" in action) {
    walkCondition(action.condition, [...path, "condition"], issues);
    return;
  }

  if ("wait_until" in action) {
    walkCondition(
      action.wait_until.condition,
      [...path, "wait_until", "condition"],
      issues,
    );
    return;
  }

  if ("wait_for_trigger" in action) {
    const { filter } = action.wait_for_trigger;
    if (typeof filter === "string") {
      flagExpression(filter, [...path, "wait_for_trigger", "filter"], issues);
    }
    return;
  }

  if ("repeat" in action) {
    const { repeat } = action;
    if ("for_each" in repeat) {
      flagExpression(repeat.for_each, [...path, "repeat", "for_each"], issues);
    }
    if ("while" in repeat) {
      flagExpression(repeat.while, [...path, "repeat", "while"], issues);
    }
    if ("until" in repeat) {
      flagExpression(repeat.until, [...path, "repeat", "until"], issues);
    }
    walkActions(repeat.sequence, [...path, "repeat", "sequence"], issues);
    return;
  }

  if ("parallel" in action) {
    walkActions(action.parallel, [...path, "parallel"], issues);
    return;
  }

  if ("sequence" in action) {
    walkActions(action.sequence, [...path, "sequence"], issues);
    return;
  }

  // `delay` / `variables` / `stop` carry no expression fields.
}

function walkActions(
  actions: ActionInput[],
  basePath: Array<string | number>,
  issues: ExpressionIssue[],
): void {
  for (const [i, action] of actions.entries()) {
    walkAction(action, [...basePath, i], issues);
  }
}

/**
 * Collect every expression field in the definition that wrongly contains a
 * `{{ }}` template delimiter. Returns an empty array when all expression fields
 * are clean.
 */
export function collectExpressionDelimiterIssues(
  definition: AutomationDefinition,
): ExpressionIssue[] {
  const issues: ExpressionIssue[] = [];

  for (const [i, trigger] of definition.triggers.entries()) {
    if (typeof trigger.filter === "string") {
      flagExpression(trigger.filter, ["triggers", i, "filter"], issues);
    }
    const partitionBy = trigger.window?.partitionBy;
    if (typeof partitionBy === "string") {
      flagExpression(
        partitionBy,
        ["triggers", i, "window", "partitionBy"],
        issues,
      );
    }
  }

  for (const [i, condition] of definition.conditions.entries()) {
    walkCondition(condition, ["conditions", i], issues);
  }

  walkActions(definition.actions, ["actions"], issues);

  return issues;
}
