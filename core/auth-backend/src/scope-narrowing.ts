/**
 * OAuth scope narrowing (introspect-time) for the AI platform OAuth AS.
 *
 * Scope strings ARE qualified access-rule IDs (the same vocabulary
 * `autoAuthMiddleware` enforces), plus a thin two-bundle umbrella layer:
 * - `checkstack:read`  -> every registered `*.read` rule.
 * - `checkstack:write` -> every registered `*.read` + `*.manage` rule.
 *
 * Bundles are expanded from the LIVE access-rule catalog (never a hand-kept
 * list) BEFORE intersection, so a bundle can still only ever narrow.
 *
 * The single invariant (LOCKED, decision 4): the narrowed set is always a
 * subset of the principal's real rules. A token can only NARROW a principal,
 * never widen it. This module is pure so the invariant is property/fuzz-tested
 * (`scope-narrowing.test.ts`) without any DB.
 */

/** The two curated umbrella scopes (decision §12). */
export const SCOPE_BUNDLE = {
  read: "checkstack:read",
  write: "checkstack:write",
} as const;

export type ScopeBundle = (typeof SCOPE_BUNDLE)[keyof typeof SCOPE_BUNDLE];

/** The admin wildcard rule (mirrors `enrichUser`'s admin -> `["*"]`). */
const ADMIN_WILDCARD = "*";

function isReadRule(ruleId: string): boolean {
  return ruleId.endsWith(".read");
}

function isManageRule(ruleId: string): boolean {
  return ruleId.endsWith(".manage");
}

/**
 * Expand the bundle umbrella scopes against the live catalog. Raw access-rule
 * IDs pass through unchanged; unknown bundle strings are dropped (a client
 * cannot invent a scope that maps to nothing useful).
 */
export function expandBundles({
  requested,
  catalog,
}: {
  /** The token's granted scope strings (raw IDs and/or bundle IDs). */
  requested: readonly string[];
  /** All currently-registered qualified access-rule IDs. */
  catalog: readonly string[];
}): string[] {
  const expanded = new Set<string>();
  for (const scope of requested) {
    if (scope === SCOPE_BUNDLE.read) {
      for (const id of catalog) if (isReadRule(id)) expanded.add(id);
    } else if (scope === SCOPE_BUNDLE.write) {
      for (const id of catalog) {
        if (isReadRule(id) || isManageRule(id)) expanded.add(id);
      }
    } else {
      // Raw access-rule ID — keep verbatim (validated by the intersection).
      expanded.add(scope);
    }
  }
  return [...expanded];
}

/**
 * The principal's EFFECTIVE rule set, used as the intersection ceiling. An
 * admin (`accessRules` contains `"*"`) is treated as holding the entire live
 * catalog, so an admin's token CAN carry any granted rule — but still only the
 * rules the token was granted, never the bare `"*"` god-scope.
 */
function effectiveRules({
  principalRules,
  catalog,
}: {
  principalRules: readonly string[];
  catalog: readonly string[];
}): Set<string> {
  if (principalRules.includes(ADMIN_WILDCARD)) {
    return new Set(catalog);
  }
  return new Set(principalRules);
}

/**
 * Narrow a token's granted scopes against the principal's LIVE rules.
 *
 * `narrowed = expandBundles(requested) ∩ effectiveRules(principalRules)`.
 *
 * Guarantees (proven by the property test):
 * - `narrowed ⊆ effectiveRules(principalRules)` — never widens.
 * - the result never contains the bare `"*"` wildcard (admin tokens carry the
 *   concrete expanded set, so a leaked admin token is not a god-token).
 */
export function narrowScopes({
  requested,
  principalRules,
  catalog,
}: {
  requested: readonly string[];
  principalRules: readonly string[];
  catalog: readonly string[];
}): string[] {
  const expanded = expandBundles({ requested, catalog });
  const ceiling = effectiveRules({ principalRules, catalog });
  const narrowed = new Set<string>();
  for (const rule of expanded) {
    if (rule === ADMIN_WILDCARD) continue; // never propagate the god-scope
    if (ceiling.has(rule)) narrowed.add(rule);
  }
  return [...narrowed];
}
