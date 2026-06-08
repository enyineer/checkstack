/**
 * Provider-agnostic helpers for `x-options-resolver` config fields - the
 * dynamic-option (cascading dropdown) fields an integration action declares
 * (e.g. Jira `projectKey` / `issueTypeId` / `priorityId`). The UI resolves these
 * against the live provider so the operator can only pick valid values; these
 * helpers let the AI tool and propose-time validation do the SAME, for ANY
 * provider's resolver fields, honouring each field's declared dependencies.
 *
 * Pure (no I/O) and dependency-light so they are unit-testable in isolation; the
 * actual resolution RPC is layered on top by the callers.
 */
import type { ActionInput } from "@checkstack/automation-common";

/** The dependency name reserved for the connection itself (a separate param). */
export const CONNECTION_DEP = "connectionId";

/** A config field backed by a dynamic-options resolver, with its dependencies. */
export interface ResolverField {
  /** The config field name (e.g. "issueTypeId"). */
  field: string;
  /** The provider resolver to invoke (the `x-options-resolver` value). */
  resolverName: string;
  /**
   * Fields this resolver depends on (`x-depends-on`), e.g. issueTypeId depends
   * on `["connectionId", "projectKey"]`. May include `connectionId`, which is
   * passed as its own param (not in the resolver context).
   */
  dependsOn: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Read one config field's resolver declaration from a JSON config schema (the
 * `configSchema` returned by `automation.listActions`). Returns `undefined` when
 * the field does not exist or carries no `x-options-resolver`.
 */
export function getResolverField(
  configSchema: unknown,
  field: string,
): ResolverField | undefined {
  const properties = asRecord(asRecord(configSchema)?.properties);
  const property = asRecord(properties?.[field]);
  if (!property) return undefined;

  const resolverName = property["x-options-resolver"];
  if (typeof resolverName !== "string" || resolverName.length === 0) {
    return undefined;
  }

  const rawDependsOn = property["x-depends-on"];
  const dependsOn = Array.isArray(rawDependsOn)
    ? rawDependsOn.filter((d): d is string => typeof d === "string")
    : [];

  return { field, resolverName, dependsOn };
}

/** Every resolver-backed field declared on a config schema. */
export function listResolverFields(configSchema: unknown): ResolverField[] {
  const properties = asRecord(asRecord(configSchema)?.properties);
  if (!properties) return [];
  const out: ResolverField[] = [];
  for (const field of Object.keys(properties)) {
    const resolved = getResolverField(configSchema, field);
    if (resolved) out.push(resolved);
  }
  return out;
}

/**
 * Build the resolver `context` (the dependency values the provider reads, e.g.
 * `{ projectKey }`) from whatever values are available, and report any required
 * dependency that is absent or unusable. `connectionId` is excluded - it is
 * passed to the resolver as its own param. A value is "missing" when it is
 * undefined/null/empty or a template (`{{ ... }}` / `${{ ... }}`), since a
 * template cannot be resolved without running the automation.
 */
export function buildResolverContext({
  dependsOn,
  values,
}: {
  dependsOn: string[];
  values: Record<string, unknown>;
}): { context: Record<string, unknown>; missing: string[] } {
  const context: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const dep of dependsOn) {
    if (dep === CONNECTION_DEP) continue;
    const value = values[dep];
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      (typeof value === "string" &&
        (value.includes("{{") || value.includes("${{")))
    ) {
      missing.push(dep);
      continue;
    }
    context[dep] = value;
  }
  return { context, missing };
}

/** A provider-action step found in the definition tree, with its issue path. */
export interface ProviderActionNode {
  action: Extract<ActionInput, { action: string }>;
  path: Array<string | number>;
}

/**
 * Flatten every provider-action step (`{ action: "..." }`) out of an action
 * tree, recursing the control-flow shapes (choose/else, parallel, repeat,
 * sequence). Reusable by any walk that needs per-action validation; the issue
 * path mirrors the definition shape for editor highlighting.
 */
export function collectProviderActionNodes(
  actions: ActionInput[],
  basePath: Array<string | number> = ["actions"],
): ProviderActionNode[] {
  const out: ProviderActionNode[] = [];
  const visit = (list: ActionInput[], path: Array<string | number>): void => {
    for (const [index, action] of list.entries()) {
      const here = [...path, index];
      if ("action" in action) {
        out.push({ action, path: here });
        continue;
      }
      if ("choose" in action) {
        for (const [branchIndex, branch] of action.choose.entries()) {
          visit(branch.sequence, [...here, "choose", branchIndex, "sequence"]);
        }
        if (action.else) visit(action.else, [...here, "else"]);
        continue;
      }
      if ("parallel" in action) {
        visit(action.parallel, [...here, "parallel"]);
        continue;
      }
      if ("repeat" in action) {
        visit(action.repeat.sequence, [...here, "repeat", "sequence"]);
        continue;
      }
      if ("sequence" in action) {
        visit(action.sequence, [...here, "sequence"]);
        continue;
      }
    }
  };
  visit(actions, basePath);
  return out;
}
