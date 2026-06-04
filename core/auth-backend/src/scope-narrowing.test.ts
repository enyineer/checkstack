import { describe, expect, test } from "bun:test";
import {
  SCOPE_BUNDLE,
  expandBundles,
  narrowScopes,
} from "./scope-narrowing";

const CATALOG = [
  "incident.incident.read",
  "incident.incident.manage",
  "healthcheck.config.read",
  "healthcheck.config.manage",
  "anomaly.anomaly.read",
  "ai.tools.manage",
];

describe("expandBundles", () => {
  test("checkstack:read expands to every *.read rule", () => {
    expect(
      expandBundles({ requested: [SCOPE_BUNDLE.read], catalog: CATALOG }).sort(),
    ).toEqual(
      [
        "incident.incident.read",
        "healthcheck.config.read",
        "anomaly.anomaly.read",
      ].sort(),
    );
  });

  test("checkstack:write expands to every *.read + *.manage rule", () => {
    expect(
      expandBundles({
        requested: [SCOPE_BUNDLE.write],
        catalog: CATALOG,
      }).sort(),
    ).toEqual([...CATALOG].sort());
  });

  test("raw rule IDs pass through unchanged", () => {
    expect(
      expandBundles({
        requested: ["incident.incident.read"],
        catalog: CATALOG,
      }),
    ).toEqual(["incident.incident.read"]);
  });

  test("unknown bundle-like strings are kept verbatim (intersection drops them)", () => {
    // Not a known bundle: kept as a raw id, then dropped by narrowScopes.
    expect(
      expandBundles({ requested: ["checkstack:everything"], catalog: CATALOG }),
    ).toEqual(["checkstack:everything"]);
  });
});

describe("narrowScopes", () => {
  test("intersects granted scopes with the principal's live rules", () => {
    const narrowed = narrowScopes({
      requested: ["incident.incident.read", "incident.incident.manage"],
      principalRules: ["incident.incident.read", "anomaly.anomaly.read"],
      catalog: CATALOG,
    });
    // manage was granted but the principal lacks it -> dropped.
    expect(narrowed).toEqual(["incident.incident.read"]);
  });

  test("checkstack:write narrows to only what the principal actually has", () => {
    const narrowed = narrowScopes({
      requested: [SCOPE_BUNDLE.write],
      principalRules: ["incident.incident.read"],
      catalog: CATALOG,
    });
    expect(narrowed).toEqual(["incident.incident.read"]);
  });

  test("admin (*) can carry any granted rule but NEVER the bare wildcard", () => {
    const narrowed = narrowScopes({
      requested: [SCOPE_BUNDLE.write],
      principalRules: ["*"],
      catalog: CATALOG,
    });
    expect(narrowed.sort()).toEqual([...CATALOG].sort());
    expect(narrowed).not.toContain("*");
  });

  test("a rule the principal has since LOST is dropped (live narrowing)", () => {
    // Token granted incident.manage, but the principal no longer holds it.
    const narrowed = narrowScopes({
      requested: ["incident.incident.manage"],
      principalRules: ["incident.incident.read"],
      catalog: CATALOG,
    });
    expect(narrowed).toEqual([]);
  });

  // Matrix #5 (Phase 5 hardening, named): the narrow-only invariant is the
  // single most important OAuth property — a token can only ever narrow, never
  // widen, what its bound principal could already do. We restate it as an
  // explicit, named hardening assertion (the fuzz below is the exhaustive
  // backstop) so the security suite carries it as a first-class regression
  // guard, not buried in a generic property test.
  test("HARDENING: scope narrowing can NEVER widen a principal", () => {
    // A token that requests MORE than the principal holds gains nothing extra.
    const escalation = narrowScopes({
      requested: [
        "incident.incident.read",
        "incident.incident.manage", // not held
        "healthcheck.config.manage", // not held
        SCOPE_BUNDLE.write, // a bundle that would expand to manage rules
      ],
      principalRules: ["incident.incident.read"],
      catalog: CATALOG,
    });
    expect(escalation).toEqual(["incident.incident.read"]);
    // A leaked admin token is NOT a god-token: it carries only the granted set,
    // never the bare wildcard.
    const adminGranted = narrowScopes({
      requested: ["incident.incident.read"],
      principalRules: ["*"],
      catalog: CATALOG,
    });
    expect(adminGranted).toEqual(["incident.incident.read"]);
    expect(adminGranted).not.toContain("*");
  });

  // Matrix #5: property/fuzz — narrowing can NEVER widen.
  test("PROPERTY: narrowed is always a subset of the principal's effective rules", () => {
    const universe = [...CATALOG, "*", SCOPE_BUNDLE.read, SCOPE_BUNDLE.write];
    const rand = (n: number) => Math.floor(Math.random() * n);
    const pick = (pool: string[]) =>
      pool.filter(() => Math.random() < 0.5);

    for (let i = 0; i < 1000; i++) {
      const requested = pick(universe);
      const principalRules = pick(universe).filter(
        (r) => r !== SCOPE_BUNDLE.read && r !== SCOPE_BUNDLE.write,
      );
      // Occasionally include the admin wildcard.
      if (rand(5) === 0) principalRules.push("*");

      const narrowed = narrowScopes({
        requested,
        principalRules,
        catalog: CATALOG,
      });

      const isAdmin = principalRules.includes("*");
      const effective = new Set(isAdmin ? CATALOG : principalRules);
      for (const rule of narrowed) {
        // Never widens: every narrowed rule is within the effective ceiling.
        expect(effective.has(rule)).toBe(true);
        // Never the bare god-scope.
        expect(rule).not.toBe("*");
      }
    }
  });
});
