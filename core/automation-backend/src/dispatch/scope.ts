/**
 * Variable scope construction for the dispatch engine.
 *
 * The shape exposed to templates is:
 *
 *   trigger.id, trigger.event, trigger.payload.*
 *   trigger.actor.{type,id,name}                 (who/what caused the event)
 *   variables.*                                  (from `variables` blocks)
 *   artifacts.<actionId>.<localArtifactName>.*  (set when an action produces)
 *   repeat.item, repeat.index                    (only inside a repeat)
 *   now (helper, ISO string of dispatch start)
 *
 * Keep this shape stable — the editor's intellisense reads it.
 */
import { SYSTEM_ACTOR, type Actor } from "@checkstack/common";
import type { DispatchContext } from "./types";

/**
 * Build the initial scope at run start. Subsequent blocks (variables,
 * repeat) clone-and-extend this scope rather than mutating it, so a
 * variable defined inside a nested block does not leak to siblings.
 *
 * `actor` carries who/what caused the originating event (a user, an
 * application/API client, a service, or the system). It defaults to the
 * system actor so callers that don't have one still produce a complete scope.
 */
export function buildInitialScope(args: {
  triggerId: string;
  triggerEventId: string;
  payload: Record<string, unknown>;
  actor?: Actor;
  startedAt: Date;
}): Record<string, unknown> {
  return {
    trigger: {
      id: args.triggerId,
      event: args.triggerEventId,
      // Back-compat alias for the former internal key. Templates and the
      // editor use `trigger.event`; `eventId` stays so older saved scope
      // snapshots / automations referencing it keep resolving.
      eventId: args.triggerEventId,
      actor: args.actor ?? SYSTEM_ACTOR,
      payload: args.payload,
    },
    variables: {},
    artifacts: {},
    now: args.startedAt.toISOString(),
  };
}

/**
 * Clone a scope, optionally extending it with new fields. Used to push
 * down a child scope when entering nested blocks (variables, repeat
 * iteration body). The structural clone is shallow at the top level —
 * inner objects are shared, which is fine because primitives never
 * mutate them.
 */
export function extendScope(
  scope: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...scope, ...patch };
}

/**
 * Push `variables.*` updates. Variable defs run before any downstream
 * action, so we merge into the existing `variables` namespace.
 */
export function extendVariables(
  scope: Record<string, unknown>,
  newVars: Record<string, unknown>,
): Record<string, unknown> {
  const existing = (scope.variables as Record<string, unknown>) ?? {};
  return { ...scope, variables: { ...existing, ...newVars } };
}

/**
 * Push `repeat.*` info onto the scope for the iteration body.
 */
export function withRepeatContext(
  scope: Record<string, unknown>,
  repeat: { index: number; item?: unknown },
): Record<string, unknown> {
  return { ...scope, repeat };
}

/**
 * Resolve and attach upstream artifacts the calling action declared in
 * `consumes`. Looks up each type within the current run's scope and
 * exposes the data under `artifacts.<type>`.
 *
 * Conflict policy: if multiple actions in the same automation produced
 * the same artifact type, the most-recent open artifact wins. Operators
 * who want explicit producer pinning should reference by action id in a
 * template (`artifacts.<id>.<name>`), which the engine auto-populates for
 * every producing action.
 */
export async function resolveConsumedArtifacts(
  ctx: DispatchContext,
  consumes: ReadonlyArray<string>,
  ownerPluginId: string,
): Promise<Record<string, unknown>> {
  if (consumes.length === 0) return {};
  const result: Record<string, unknown> = {};

  for (const localType of consumes) {
    // `consumes` carries local artifact ids; the stored artifact type is
    // the fully-qualified `${pluginId}.${id}` the producing action wrote.
    // Qualify against the consuming action's own plugin (same-plugin
    // handoff) for the lookup, but key the result by the local id so the
    // action's `execute` reads `consumedArtifacts[localId]`.
    const qualifiedType = `${ownerPluginId}.${localType}`;
    const found = await ctx.deps.artifactStore.find({
      automationId: ctx.run.automation.id,
      contextKey: ctx.run.contextKey,
      artifactType: qualifiedType,
      onlyOpen: true,
    });
    if (found) {
      result[localType] = found.data;
    }
  }

  return result;
}
