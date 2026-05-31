import { createServiceRef, type ServiceRef } from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import type { AutomationDefinition, Action } from "@checkstack/automation-common";

import type { RunSecretRegistry } from "./run-secret-registry";

/**
 * Cross-pod mask re-seeding for resume / stalled-recovery.
 *
 * The run-wide masking registry (see {@link RunSecretRegistry}) is
 * IN-MEMORY and per-process: it only holds the secret values a run resolved
 * on THIS pod. Capture happens lazily, as actions resolve secrets through
 * the wrapped `getService`.
 *
 * That breaks across pods. When pod A resolves a connection credential and
 * the run SUSPENDS (`wait_for_trigger` / `delay` / `wait_until`), and pod B
 * later resumes that run with a FRESH, empty registry, every masking choke
 * point on pod B (step output, run error, scope snapshot, artifact data)
 * runs against an EMPTY mask set. Any persisted value that still contains
 * pod-A's resolved secret — e.g. an error string, a scope variable carried
 * over the suspension, or an artifact echoing a credential — would be
 * written UNMASKED, leaking it to `getRunScopeForReplay` and the run-detail
 * UI. This is the deferred "L2 cross-pod masking" gap.
 *
 * The fix: BEFORE pod B walks/persists anything, RE-SEED its registry by
 * re-resolving the automation's DECLARED secret refs — the `secretEnv`
 * mappings and the `connectionId` references the definition uses — through
 * the run's already-wrapped `getService`. The wrapper auto-registers every
 * resolved value, so pod B re-populates exactly the least-privilege mask
 * set the run is allowed to see (Jenkins-style, by-value). Re-resolving is
 * the SAME set the run resolves during normal execution, so it grants no
 * extra access.
 *
 * Best-effort by construction: a declared secret that no longer resolves
 * (rotated / deleted) simply isn't added to the mask set — the run would
 * have failed re-resolving it during the walk anyway. A resolution failure
 * here must never abort the resume, so each ref is resolved independently
 * and failures are swallowed (the engine surfaces a genuinely-missing
 * secret when the action re-runs).
 */

/** Shapes of the two value-returning services we re-resolve through. */
interface ResolverLike {
  resolveForRun(input: { secretEnv: Record<string, string> }): Promise<{
    env: Record<string, string>;
    masking: unknown;
  }>;
}
interface ConnectionStoreLike {
  getConnectionWithCredentials(
    connectionId: string,
  ): Promise<{ config: Record<string, unknown> } | undefined>;
}

function hasResolveForRun(s: unknown): s is ResolverLike {
  return (
    typeof s === "object" &&
    s !== null &&
    typeof (s as ResolverLike).resolveForRun === "function"
  );
}
function hasConnectionCredentials(s: unknown): s is ConnectionStoreLike {
  return (
    typeof s === "object" &&
    s !== null &&
    typeof (s as ConnectionStoreLike).getConnectionWithCredentials ===
      "function"
  );
}

/** The declared secret references found by walking a definition's actions. */
interface DeclaredSecretRefs {
  /** Distinct `secretEnv` mappings (`{ ENV: "${{ secrets.NAME }}" }`). */
  secretEnvMaps: Record<string, string>[];
  /** Distinct, literal `connectionId` values referenced by action configs. */
  connectionIds: Set<string>;
}

/**
 * Collect every `secretEnv` map and literal `connectionId` declared in an
 * automation's action configs, walking the full nested action tree
 * (choose / parallel / repeat / sequence). Templated connection ids (those
 * containing a `${{ … }}` expression) are skipped — they can only be
 * resolved against live scope, and the action that uses them re-registers
 * its credential when it re-runs.
 */
export function collectDeclaredSecretRefs(
  definition: AutomationDefinition,
): DeclaredSecretRefs {
  const secretEnvMaps: Record<string, string>[] = [];
  const connectionIds = new Set<string>();

  const visitConfig = (config: Record<string, unknown>): void => {
    const secretEnv = config.secretEnv;
    if (isStringRecord(secretEnv) && Object.keys(secretEnv).length > 0) {
      secretEnvMaps.push(secretEnv);
    }
    const connectionId = config.connectionId;
    if (
      typeof connectionId === "string" &&
      connectionId.length > 0 &&
      !connectionId.includes("${{")
    ) {
      connectionIds.add(connectionId);
    }
  };

  const visit = (action: Action): void => {
    if ("action" in action && isPlainObject(action.config)) {
      visitConfig(action.config);
    }
    if ("choose" in action) {
      for (const branch of action.choose) visitAll(branch.sequence);
      if (action.else) visitAll(action.else);
    }
    if ("parallel" in action) visitAll(action.parallel);
    if ("repeat" in action) visitAll(action.repeat.sequence);
    if ("sequence" in action) visitAll(action.sequence);
  };

  const visitAll = (actions: ReadonlyArray<Action>): void => {
    for (const action of actions) visit(action);
  };

  visitAll(definition.actions);
  return { secretEnvMaps, connectionIds };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isPlainObject(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

export interface ReseedRunSecretRegistryArgs {
  /**
   * The run's ALREADY-WRAPPED `getService` (the same one the engine threads
   * through dispatch). Resolving the secret resolver / connection store
   * through it auto-registers every resolved value into the run's mask set.
   */
  getService: <T>(ref: ServiceRef<T>) => Promise<T>;
  registry: RunSecretRegistry;
  runId: string;
  definition: AutomationDefinition;
  /** Service-ref id of the secret resolver (`secretResolverRef.id`). */
  resolverRefId: string;
  /** Service-ref id of the connection store (`connectionStoreRef.id`). */
  connectionStoreRefId: string;
  logger?: { debug(msg: string): void; warn(msg: string): void };
}

/**
 * Re-resolve an automation's declared secret refs through the run's wrapped
 * `getService`, re-populating the run's in-memory mask set on the resuming
 * pod. Call this on `resumeRun` / `recoverStalledRun` BEFORE walking the
 * tree, so the masking choke points have the full mask set on the new pod.
 */
export async function reseedRunSecretRegistry(
  args: ReseedRunSecretRegistryArgs,
): Promise<void> {
  const { secretEnvMaps, connectionIds } = collectDeclaredSecretRefs(
    args.definition,
  );
  if (secretEnvMaps.length === 0 && connectionIds.size === 0) return;

  // Resolve the two services once through the wrapped getService. The
  // wrapper returns the value-registering proxies, so the calls below feed
  // the run's mask set.
  let resolver: ResolverLike | undefined;
  let connectionStore: ConnectionStoreLike | undefined;

  if (secretEnvMaps.length > 0) {
    try {
      const svc = await args.getService(
        createServiceRef<unknown>(args.resolverRefId),
      );
      if (hasResolveForRun(svc)) resolver = svc;
    } catch (error) {
      args.logger?.warn(
        `reseed: could not resolve secret resolver for run ${args.runId}: ${extractErrorMessage(error)}`,
      );
    }
  }
  if (connectionIds.size > 0) {
    try {
      const svc = await args.getService(
        createServiceRef<unknown>(args.connectionStoreRefId),
      );
      if (hasConnectionCredentials(svc)) connectionStore = svc;
    } catch (error) {
      args.logger?.warn(
        `reseed: could not resolve connection store for run ${args.runId}: ${extractErrorMessage(error)}`,
      );
    }
  }

  if (resolver) {
    for (const secretEnv of secretEnvMaps) {
      try {
        // The wrapped resolver registers every resolved value as a side
        // effect; we don't need the returned env.
        await resolver.resolveForRun({ secretEnv });
      } catch (error) {
        // A rotated/missing secret would fail the action's own re-run; here
        // we just skip adding it to the mask set.
        args.logger?.debug(
          `reseed: secretEnv re-resolve skipped for run ${args.runId}: ${extractErrorMessage(error)}`,
        );
      }
    }
  }

  if (connectionStore) {
    for (const connectionId of connectionIds) {
      try {
        await connectionStore.getConnectionWithCredentials(connectionId);
      } catch (error) {
        args.logger?.debug(
          `reseed: connection re-resolve skipped for run ${args.runId} (${connectionId}): ${extractErrorMessage(error)}`,
        );
      }
    }
  }
}

