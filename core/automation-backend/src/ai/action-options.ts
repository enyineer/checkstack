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
 * Descend a JSON-schema by a DOTTED field path, stepping through object
 * `properties` and array `items.properties` at each segment. So `projectKey`
 * resolves a top-level field, and `fieldMappings.fieldKey` resolves the
 * per-row `fieldKey` inside the `fieldMappings` array. Returns the leaf
 * property schema, or `undefined` if any segment is missing.
 */
function resolvePropertySchema(
  configSchema: unknown,
  fieldPath: string,
): Record<string, unknown> | undefined {
  let container = asRecord(asRecord(configSchema)?.properties);
  let property: Record<string, unknown> | undefined;
  for (const segment of fieldPath.split(".")) {
    if (!container) return undefined;
    property = asRecord(container[segment]);
    if (!property) return undefined;
    // Prepare the container for the NEXT segment: an array exposes its row
    // shape under `items.properties`; an object under `properties`.
    container =
      property.type === "array"
        ? asRecord(asRecord(property.items)?.properties)
        : asRecord(property.properties);
  }
  return property;
}

/** Read a resolver declaration off a leaf property schema, if it has one. */
function asResolverField(
  field: string,
  property: Record<string, unknown> | undefined,
): ResolverField | undefined {
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

/**
 * Read one config field's resolver declaration from a JSON config schema (the
 * `configSchema` returned by `automation.listActions`). Accepts a DOTTED path
 * for a field nested inside an array of rows (e.g. `fieldMappings.fieldKey`).
 * Returns `undefined` when the field does not exist or carries no
 * `x-options-resolver`.
 */
export function getResolverField(
  configSchema: unknown,
  field: string,
): ResolverField | undefined {
  return asResolverField(field, resolvePropertySchema(configSchema, field));
}

/**
 * Every resolver-backed field declared on a config schema, INCLUDING fields
 * nested one or more levels inside arrays/objects (emitted as dotted paths, e.g.
 * `fieldMappings.fieldKey`). A bounded recursion guards against pathological
 * schemas (config schemas are shallow trees in practice).
 */
export function listResolverFields(configSchema: unknown): ResolverField[] {
  const out: ResolverField[] = [];
  const walk = (
    properties: Record<string, unknown> | undefined,
    prefix: string,
    depth: number,
  ): void => {
    if (!properties || depth > 5) return;
    for (const key of Object.keys(properties)) {
      const property = asRecord(properties[key]);
      if (!property) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const resolver = asResolverField(path, property);
      if (resolver) out.push(resolver);
      const nested =
        property.type === "array"
          ? asRecord(asRecord(property.items)?.properties)
          : asRecord(property.properties);
      if (nested) walk(nested, path, depth + 1);
    }
  };
  walk(asRecord(asRecord(configSchema)?.properties), "", 0);
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
