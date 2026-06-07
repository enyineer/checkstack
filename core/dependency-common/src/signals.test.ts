import { describe, expect, test } from "bun:test";
import {
  deriveDependencySignals,
  DEPENDENCY_SIGNAL_SOURCE_ID,
} from "./signals";
import type { DependencyWarning } from "./schemas";

function warning(
  overrides: Partial<DependencyWarning> & Pick<DependencyWarning, "systemId">,
): DependencyWarning {
  return {
    derivedState: "down",
    affectedUpstreams: [],
    ...overrides,
  };
}

describe("deriveDependencySignals", () => {
  test("returns an empty map when there are no warnings", () => {
    expect(deriveDependencySignals({ warnings: {} })).toEqual({});
  });

  test("emits one signal per system with a warning, keyed by systemId", () => {
    const result = deriveDependencySignals({
      warnings: {
        "sys-down": warning({
          systemId: "sys-down",
          derivedState: "down",
          affectedUpstreams: [
            {
              systemId: "up-1",
              systemName: "Upstream 1",
              ownStatus: "down",
              impactType: "critical",
              dependencyLabel: null,
            },
          ],
        }),
        "sys-degraded": warning({
          systemId: "sys-degraded",
          derivedState: "degraded",
          affectedUpstreams: [
            {
              systemId: "up-2",
              systemName: "Upstream 2",
              ownStatus: "degraded",
              impactType: "degraded",
              dependencyLabel: null,
            },
            {
              systemId: "up-3",
              systemName: "Upstream 3",
              ownStatus: "degraded",
              impactType: "degraded",
              dependencyLabel: null,
            },
          ],
        }),
      },
    });

    expect(Object.keys(result).sort()).toEqual(["sys-degraded", "sys-down"]);
    expect(result["sys-down"]).toHaveLength(1);
    expect(result["sys-degraded"]).toHaveLength(1);
  });

  test("maps derived state to the correct tone and label", () => {
    const result = deriveDependencySignals({
      warnings: {
        down: warning({ systemId: "down", derivedState: "down" }),
        degraded: warning({ systemId: "degraded", derivedState: "degraded" }),
        info: warning({ systemId: "info", derivedState: "info" }),
      },
    });

    expect(result["down"][0]).toMatchObject({
      tone: "error",
      label: "Upstream down",
    });
    expect(result["degraded"][0]).toMatchObject({
      tone: "warn",
      label: "Upstream degraded",
    });
    expect(result["info"][0]).toMatchObject({
      tone: "info",
      label: "Dependency info",
    });
  });

  test("sets the shared source id and a deep link to the dependency map", () => {
    const result = deriveDependencySignals({
      warnings: {
        s1: warning({
          systemId: "s1",
          affectedUpstreams: [
            {
              systemId: "u1",
              systemName: "U1",
              ownStatus: "down",
              impactType: "critical",
              dependencyLabel: null,
            },
          ],
        }),
      },
    });

    const signal = result["s1"][0];
    expect(signal.source).toBe(DEPENDENCY_SIGNAL_SOURCE_ID);
    expect(signal.iconName).toBe("GitBranch");
    expect(signal.href).toBeTruthy();
    expect(signal.accessRule).toBeDefined();
  });

  test("pluralizes the affected-upstreams detail and omits it when none", () => {
    const result = deriveDependencySignals({
      warnings: {
        one: warning({
          systemId: "one",
          affectedUpstreams: [
            {
              systemId: "u1",
              systemName: "U1",
              ownStatus: "down",
              impactType: "critical",
              dependencyLabel: null,
            },
          ],
        }),
        many: warning({
          systemId: "many",
          affectedUpstreams: [
            {
              systemId: "u1",
              systemName: "U1",
              ownStatus: "down",
              impactType: "critical",
              dependencyLabel: null,
            },
            {
              systemId: "u2",
              systemName: "U2",
              ownStatus: "down",
              impactType: "critical",
              dependencyLabel: null,
            },
          ],
        }),
        none: warning({ systemId: "none", affectedUpstreams: [] }),
      },
    });

    expect(result["one"][0].detail).toBe("1 upstream system affected");
    expect(result["many"][0].detail).toBe("2 upstream systems affected");
    expect(result["none"][0].detail).toBeUndefined();
  });
});
