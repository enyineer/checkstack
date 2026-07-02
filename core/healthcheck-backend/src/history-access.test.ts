import { describe, expect, test } from "bun:test";
import type { AuthService, AuthUser } from "@checkstack/backend-api";
import {
  canReadRunScope,
  hasGlobalHistoryAccess,
  listManageableSystemIds,
  listTeamManageableConfigurationIds,
  resolveHistoryScope,
} from "./history-access";

/**
 * Regression guard for the run-history authorization: global
 * `configuration.manage` (or wildcard/service) yields unrestricted access, a
 * team-scoped caller is restricted to runs of their granted CONFIGURATIONS
 * plus all runs of the SYSTEMS they manage (a system's owning team sees every
 * run of that system, whoever owns the configuration), anyone else is
 * forbidden, and any auth (S2S) failure fails CLOSED.
 */

const QUALIFIED_MANAGE = "healthcheck.healthcheck.manage";
const QUALIFIED_SYSTEM_MANAGE = "catalog.system.manage";

const realUser = (accessRules: string[]): AuthUser => ({
  type: "user",
  id: "u1",
  accessRules,
});

// Cast is unavoidable for a partial mock: the helpers only touch
// `listAccessibleObjectIds` / `check`, and implementing the full AuthService
// here would just be noise.
const authWith = (impl: Partial<AuthService>): AuthService =>
  impl as unknown as AuthService;

describe("hasGlobalHistoryAccess", () => {
  test("true for global manage, wildcard, and services; false otherwise", () => {
    expect(hasGlobalHistoryAccess(realUser([QUALIFIED_MANAGE]))).toBe(true);
    expect(hasGlobalHistoryAccess(realUser(["*"]))).toBe(true);
    expect(hasGlobalHistoryAccess({ type: "service", pluginId: "slo" })).toBe(
      true,
    );
    expect(hasGlobalHistoryAccess(realUser(["healthcheck.healthcheck.read"]))).toBe(
      false,
    );
    expect(hasGlobalHistoryAccess(undefined)).toBe(false);
  });
});

describe("resolveHistoryScope", () => {
  test("global manage rule yields the unfiltered feed", () => {
    expect(
      resolveHistoryScope({
        user: realUser([QUALIFIED_MANAGE]),
        accessibleConfigurationIds: [],
        accessibleSystemIds: [],
      }),
    ).toEqual({ kind: "all" });
  });

  test("configuration grants scope the feed", () => {
    expect(
      resolveHistoryScope({
        user: realUser([]),
        accessibleConfigurationIds: ["cfg-1"],
        accessibleSystemIds: [],
      }),
    ).toEqual({ kind: "scoped", configurationIds: ["cfg-1"], systemIds: [] });
  });

  test("system manage alone scopes the feed (owning team sees its runs)", () => {
    expect(
      resolveHistoryScope({
        user: realUser([]),
        accessibleConfigurationIds: [],
        accessibleSystemIds: ["sys-1"],
      }),
    ).toEqual({ kind: "scoped", configurationIds: [], systemIds: ["sys-1"] });
  });

  test("no global rule and no grant of either kind is forbidden", () => {
    expect(
      resolveHistoryScope({
        user: realUser(["healthcheck.healthcheck.read"]),
        accessibleConfigurationIds: [],
        accessibleSystemIds: [],
      }),
    ).toEqual({ kind: "forbidden" });
  });

  test("missing user is forbidden", () => {
    expect(
      resolveHistoryScope({
        user: undefined,
        accessibleConfigurationIds: [],
        accessibleSystemIds: [],
      }),
    ).toEqual({ kind: "forbidden" });
  });

  test("a manage rule from ANOTHER plugin does not unlock the feed", () => {
    expect(
      resolveHistoryScope({
        user: realUser(["incident.incident.manage"]),
        accessibleConfigurationIds: [],
        accessibleSystemIds: [],
      }),
    ).toEqual({ kind: "forbidden" });
  });
});

describe("listTeamManageableConfigurationIds", () => {
  test("resolves the manage-granted subset via the auth S2S", async () => {
    const auth = authWith({
      listAccessibleObjectIds: async ({ objectType, action, objectIds }) => {
        expect(objectType).toBe("healthcheck.healthcheck");
        expect(action).toBe("manage");
        return objectIds.filter((id) => id === "cfg-2");
      },
    });

    await expect(
      listTeamManageableConfigurationIds({
        auth,
        user: realUser([]),
        allConfigurationIds: ["cfg-1", "cfg-2"],
      }),
    ).resolves.toEqual(["cfg-2"]);
  });

  test("fails CLOSED when the auth S2S errors", async () => {
    const auth = authWith({
      listAccessibleObjectIds: async () => {
        throw new Error("auth down");
      },
    });

    await expect(
      listTeamManageableConfigurationIds({
        auth,
        user: realUser([]),
        allConfigurationIds: ["cfg-1"],
      }),
    ).resolves.toEqual([]);
  });
});

describe("listManageableSystemIds", () => {
  test("resolves the team-granted subset keyed on catalog.system manage", async () => {
    const auth = authWith({
      listAccessibleObjectIds: async ({ objectType, action, objectIds }) => {
        expect(objectType).toBe("catalog.system");
        expect(action).toBe("manage");
        return objectIds.filter((id) => id === "sys-1");
      },
    });

    await expect(
      listManageableSystemIds({
        auth,
        user: realUser([]),
        allSystemIds: ["sys-1", "sys-2"],
      }),
    ).resolves.toEqual(["sys-1"]);
  });

  test("the global catalog.system.manage rule grants every system (parentScope convention)", async () => {
    const auth = authWith({
      listAccessibleObjectIds: async () => {
        throw new Error("must not be called");
      },
    });

    await expect(
      listManageableSystemIds({
        auth,
        user: realUser([QUALIFIED_SYSTEM_MANAGE]),
        allSystemIds: ["sys-1", "sys-2"],
      }),
    ).resolves.toEqual(["sys-1", "sys-2"]);
  });

  test("fails CLOSED when the auth S2S errors", async () => {
    const auth = authWith({
      listAccessibleObjectIds: async () => {
        throw new Error("auth down");
      },
    });

    await expect(
      listManageableSystemIds({
        auth,
        user: realUser([]),
        allSystemIds: ["sys-1"],
      }),
    ).resolves.toEqual([]);
  });
});

describe("canReadRunScope", () => {
  const scope = { configurationId: "cfg-1", systemId: "sys-1" };

  test("global healthcheck manage allows without any S2S call", async () => {
    const auth = authWith({
      check: async () => {
        throw new Error("must not be called");
      },
    });

    await expect(
      canReadRunScope({ auth, user: realUser([QUALIFIED_MANAGE]), ...scope }),
    ).resolves.toBe(true);
  });

  test("a team grant on the CONFIGURATION allows", async () => {
    const auth = authWith({
      check: async ({ objectType, objectId }) => ({
        hasAccess:
          objectType === "healthcheck.healthcheck" && objectId === "cfg-1",
      }),
    });

    await expect(
      canReadRunScope({ auth, user: realUser([]), ...scope }),
    ).resolves.toBe(true);
  });

  test("a team grant on the SYSTEM allows even without a configuration grant", async () => {
    const auth = authWith({
      check: async ({ objectType, objectId }) => ({
        hasAccess: objectType === "catalog.system" && objectId === "sys-1",
      }),
    });

    await expect(
      canReadRunScope({ auth, user: realUser([]), ...scope }),
    ).resolves.toBe(true);
  });

  test("the global catalog.system.manage rule allows (parentScope convention)", async () => {
    const auth = authWith({
      check: async () => {
        throw new Error("must not be called");
      },
    });

    await expect(
      canReadRunScope({
        auth,
        user: realUser([QUALIFIED_SYSTEM_MANAGE]),
        ...scope,
      }),
    ).resolves.toBe(true);
  });

  test("no grant of either kind denies", async () => {
    const auth = authWith({
      check: async () => ({ hasAccess: false }),
    });

    await expect(
      canReadRunScope({ auth, user: realUser([]), ...scope }),
    ).resolves.toBe(false);
  });

  test("missing user denies", async () => {
    const auth = authWith({});
    await expect(
      canReadRunScope({ auth, user: undefined, ...scope }),
    ).resolves.toBe(false);
  });

  test("fails CLOSED when the auth S2S errors", async () => {
    const auth = authWith({
      check: async () => {
        throw new Error("auth down");
      },
    });

    await expect(
      canReadRunScope({ auth, user: realUser([]), ...scope }),
    ).resolves.toBe(false);
  });
});
