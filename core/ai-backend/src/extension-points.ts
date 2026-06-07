import { createExtensionPoint } from "@checkstack/backend-api";
import type { AuthUser } from "@checkstack/backend-api";
import type { PluginMetadata } from "@checkstack/common";
import type { SystemSignalsMap } from "@checkstack/catalog-common";
import type { RegisteredAiTool } from "./tool-registry";
import type { ProjectToolInput } from "./projection";

/**
 * Path 1 — hand-authored composite tools (decision 2b).
 *
 * Plugins register coarser/curated tools (e.g. `automation.propose`) here when
 * the model needs a different surface than raw CRUD. The tool name is qualified
 * with the registering plugin id before it reaches the registry.
 */
export interface AiToolExtensionPoint {
  registerTool<TInput, TOutput>(
    tool: RegisteredAiTool<TInput, TOutput>,
    pluginMetadata: PluginMetadata,
  ): void;
}

export const aiToolExtensionPoint = createExtensionPoint<AiToolExtensionPoint>(
  "ai.toolExtensionPoint",
);

/**
 * Path 2 — opt-in projection of an existing oRPC procedure (decision 2a).
 *
 * The projected tool reads the procedure's access rules and input schema
 * verbatim; nothing is duplicated. `effect` is REQUIRED and never inferred.
 *
 * The owning plugin metadata lives on `input.sourcePluginMetadata` (it must be
 * the SOURCE procedure's plugin so qualified access-rule IDs match what
 * `autoAuthMiddleware` enforces), so `expose` takes no separate metadata arg.
 */
export interface AiToolProjectionExtensionPoint {
  expose<TInput, TOutput>(input: ProjectToolInput<TInput, TOutput>): void;
}

export const aiToolProjectionExtensionPoint =
  createExtensionPoint<AiToolProjectionExtensionPoint>(
    "ai.toolProjectionExtensionPoint",
  );

/**
 * A single backend contributor of dashboard "needs attention" system signals.
 *
 * This mirrors the FRONTEND `SystemSignalsSlot` concept on the backend: where a
 * frontend plugin's React filler computes per-system `SystemSignal[]` from a
 * bulk RPC and reports via the slot, a backend plugin registers a contributor
 * here that returns problem signals for ALL systems globally (keyed by
 * systemId). The `system.issues` AI tool fans out across every registered
 * contributor and merges their maps into one "what is wrong right now" answer.
 *
 * Access: the `system.issues` tool itself is gated by `catalog.system.read`, but
 * PER-SOURCE access (and per-system/team scoping) is the contributor's own
 * responsibility - `read` receives the originating `AuthUser` principal and MUST
 * return only signals the principal is allowed to see (returning `{}` when the
 * principal lacks access). The aggregator never inspects a source's data to
 * decide visibility.
 */
export interface SystemSignalsContributor {
  /**
   * Stable id of the contributing source, e.g. "incident" / "slo" /
   * "healthcheck". Surfaced on the aggregated result so the model can attribute
   * each signal, and used to keep one source's failure from affecting others.
   */
  sourceId: string;
  /**
   * Return problem signals for ALL systems globally, keyed by systemId, scoped
   * to what `principal` may see, plus whether the principal could access this
   * source at all. Systems absent from `signals` have no signal from this
   * source. MUST resolve from shared, durable storage so the answer is
   * identical on every pod (state-and-scale rule).
   *
   * When the principal lacks access, return `{ accessible: false, signals: {} }`
   * (NOT a throw) - the aggregator surfaces that as an inaccessible source so
   * the model can say "I could not check X" instead of implying "no issues".
   */
  read(context: {
    principal: AuthUser;
  }): Promise<SystemSignalsContribution>;
}

/**
 * One contributor's reply: the signals it found (empty if none or if access was
 * denied) plus whether the principal could read the source at all. `accessible:
 * false` means "skipped for lack of permission", which the aggregator reports
 * distinctly from "checked and found nothing".
 */
export interface SystemSignalsContribution {
  accessible: boolean;
  signals: SystemSignalsMap;
}

/**
 * Backend extension point for contributing dashboard "needs attention" system
 * signals to the `system.issues` AI tool. Each plugin that owns a kind of
 * problem state (incidents, breaching/at-risk SLOs, failing health checks,
 * active anomalies, open incidents, active maintenances, dependency problems)
 * registers ONE contributor from its own backend `init`. ai-backend collects
 * every contributor and the `system.issues` tool merges their global maps in a
 * single call - ai-backend imports no plugin's `*-common` to do so.
 */
export interface SystemSignalsExtensionPoint {
  contribute(contributor: SystemSignalsContributor): void;
}

export const systemSignalsExtensionPoint =
  createExtensionPoint<SystemSignalsExtensionPoint>(
    "ai.systemSignalsExtensionPoint",
  );

/**
 * The access-rule ids a principal holds, for a {@link SystemSignalsContributor}'s
 * per-source gate. Pass the result to `isAccessRuleSatisfied`.
 *
 * Service principals are trusted backend-to-backend callers - the RPC
 * middleware (`autoAuthMiddleware`) skips access-rule checks for them entirely -
 * so they are treated here as holding the wildcard `*`, matching that behaviour.
 * Real users and applications carry their own `accessRules`. Centralising this
 * keeps every contributor's gate consistent (a service caller sees every source
 * or none, never a per-source split).
 */
export function principalGrantedRuleIds(
  principal: AuthUser,
): readonly string[] {
  if (principal.type === "service") return ["*"];
  return principal.accessRules ?? [];
}
