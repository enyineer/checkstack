import { describe, expect, test } from "bun:test";
import type { AuthService, AuthUser } from "@checkstack/backend-api";
import {
  canReadConfigurationScope,
  hasConfigurationReadGrant,
  hasGlobalConfigurationRead,
  listReadableSystemIds,
  resolveAssignmentRowScope,
} from "./assignment-access";

/**
 * Regression guard for the configuration-centric assignment authorization:
 * global `configuration.read`/`.manage` (or wildcard/service) or a team grant
 * on the CONFIGURATION yields every assignment row, a system-scoped caller is
 * restricted to the systems their teams may read, anyone else is forbidden,
 * and any auth (S2S) failure fails CLOSED.
 */

const QUALIFIED_READ = "healthcheck.healthcheck.read";
const QUALIFIED_MANAGE = "healthcheck.healthcheck.manage";
const QUALIFIED_SYSTEM_READ = "catalog.system.read";
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

describe("hasGlobalConfigurationRead", () => {
  test("true for global read, global manage, wildcard, and services; false otherwise", () => {
    expect(hasGlobalConfigurationRead(realUser([QUALIFIED_READ]))).toBe(true);
    expect(hasGlobalConfigurationRead(realUser([QUALIFIED_MANAGE]))).toBe(true);
    expect(hasGlobalConfigurationRead(realUser(["*"]))).toBe(true);
    expect(
      hasGlobalConfigurationRead({ type: "service", pluginId: "slo" }),
    ).toBe(true);
    expect(
      hasGlobalConfigurationRead(realUser([QUALIFIED_SYSTEM_MANAGE])),
    ).toBe(false);
    expect(hasGlobalConfigurationRead(undefined)).toBe(false);
  });
});

describe("resolveAssignmentRowScope", () => {
  test("global read rule yields every row", () => {
    expect(
      resolveAssignmentRowScope({
        user: realUser([QUALIFIED_READ]),
        hasConfigurationGrant: false,
        readableSystemIds: [],
      }),
    ).toEqual({ kind: "all" });
  });

  test("a configuration team grant yields every row", () => {
    expect(
      resolveAssignmentRowScope({
        user: realUser([]),
        hasConfigurationGrant: true,
        readableSystemIds: [],
      }),
    ).toEqual({ kind: "all" });
  });

  test("system grants alone scope the rows to those systems", () => {
    expect(
      resolveAssignmentRowScope({
        user: realUser([]),
        hasConfigurationGrant: false,
        readableSystemIds: ["sys-1"],
      }),
    ).toEqual({ kind: "scoped", systemIds: ["sys-1"] });
  });

  test("no global rule and no grant of either kind is forbidden", () => {
    expect(
      resolveAssignmentRowScope({
        user: realUser([]),
        hasConfigurationGrant: false,
        readableSystemIds: [],
      }),
    ).toEqual({ kind: "forbidden" });
  });

  test("missing user is forbidden", () => {
    expect(
      resolveAssignmentRowScope({
        user: undefined,
        hasConfigurationGrant: false,
        readableSystemIds: ["sys-1"],
      }),
    ).toEqual({ kind: "forbidden" });
  });

  test("a read rule from ANOTHER plugin does not unlock the rows", () => {
    expect(
      resolveAssignmentRowScope({
        user: realUser(["incident.incident.read"]),
        hasConfigurationGrant: false,
        readableSystemIds: [],
      }),
    ).toEqual({ kind: "forbidden" });
  });
});

describe("hasConfigurationReadGrant", () => {
  test("resolves a READ grant on the configuration via the auth S2S", async () => {
    const auth = authWith({
      check: async ({ objectType, objectId, action }) => {
        expect(objectType).toBe("healthcheck.healthcheck");
        expect(action).toBe("read");
        return { hasAccess: objectId === "cfg-1" };
      },
    });

    await expect(
      hasConfigurationReadGrant({
        auth,
        user: realUser([]),
        configurationId: "cfg-1",
      }),
    ).resolves.toBe(true);
    await expect(
      hasConfigurationReadGrant({
        auth,
        user: realUser([]),
        configurationId: "cfg-2",
      }),
    ).resolves.toBe(false);
  });

  test("fails CLOSED when the auth S2S errors", async () => {
    const auth = authWith({
      check: async () => {
        throw new Error("auth down");
      },
    });

    await expect(
      hasConfigurationReadGrant({
        auth,
        user: realUser([]),
        configurationId: "cfg-1",
      }),
    ).resolves.toBe(false);
  });
});

describe("listReadableSystemIds", () => {
  test("resolves the team-granted subset keyed on catalog.system read", async () => {
    const auth = authWith({
      listAccessibleObjectIds: async ({ objectType, action, objectIds }) => {
        expect(objectType).toBe("catalog.system");
        expect(action).toBe("read");
        return objectIds.filter((id) => id === "sys-1");
      },
    });

    await expect(
      listReadableSystemIds({
        auth,
        user: realUser([]),
        allSystemIds: ["sys-1", "sys-2"],
      }),
    ).resolves.toEqual(["sys-1"]);
  });

  test("the global catalog.system read and manage rules grant every system (parentScope convention)", async () => {
    const auth = authWith({
      listAccessibleObjectIds: async () => {
        throw new Error("must not be called");
      },
    });

    await expect(
      listReadableSystemIds({
        auth,
        user: realUser([QUALIFIED_SYSTEM_READ]),
        allSystemIds: ["sys-1", "sys-2"],
      }),
    ).resolves.toEqual(["sys-1", "sys-2"]);
    await expect(
      listReadableSystemIds({
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
      listReadableSystemIds({
        auth,
        user: realUser([]),
        allSystemIds: ["sys-1"],
      }),
    ).resolves.toEqual([]);
  });
});

describe("canReadConfigurationScope", () => {
  const configurationId = "cfg-1";

  test("global configuration read allows without any S2S call or assignment lookup", async () => {
    const auth = authWith({
      check: async () => {
        throw new Error("must not be called");
      },
    });

    await expect(
      canReadConfigurationScope({
        auth,
        user: realUser([QUALIFIED_READ]),
        configurationId,
        getAssignedSystemIds: async () => {
          throw new Error("must not be called");
        },
      }),
    ).resolves.toBe(true);
  });

  test("a team grant on the CONFIGURATION allows without the assignment lookup", async () => {
    const auth = authWith({
      check: async () => ({ hasAccess: true }),
    });

    await expect(
      canReadConfigurationScope({
        auth,
        user: realUser([]),
        configurationId,
        getAssignedSystemIds: async () => {
          throw new Error("must not be called");
        },
      }),
    ).resolves.toBe(true);
  });

  test("read access to an ASSIGNED system allows even without a configuration grant", async () => {
    const auth = authWith({
      check: async () => ({ hasAccess: false }),
      listAccessibleObjectIds: async ({ objectIds }) =>
        objectIds.filter((id) => id === "sys-1"),
    });

    await expect(
      canReadConfigurationScope({
        auth,
        user: realUser([]),
        configurationId,
        getAssignedSystemIds: async () => ["sys-1", "sys-2"],
      }),
    ).resolves.toBe(true);
  });

  test("a system grant unrelated to the configuration's assignments denies", async () => {
    const auth = authWith({
      check: async () => ({ hasAccess: false }),
      listAccessibleObjectIds: async () => [],
    });

    await expect(
      canReadConfigurationScope({
        auth,
        user: realUser([]),
        configurationId,
        getAssignedSystemIds: async () => ["sys-2"],
      }),
    ).resolves.toBe(false);
  });

  test("an unassigned configuration denies a caller with only system grants", async () => {
    const auth = authWith({
      check: async () => ({ hasAccess: false }),
      listAccessibleObjectIds: async () => {
        throw new Error("must not be called for an empty id set");
      },
    });

    await expect(
      canReadConfigurationScope({
        auth,
        user: realUser([]),
        configurationId,
        getAssignedSystemIds: async () => [],
      }),
    ).resolves.toBe(false);
  });

  test("missing user denies", async () => {
    await expect(
      canReadConfigurationScope({
        auth: authWith({}),
        user: undefined,
        configurationId,
        getAssignedSystemIds: async () => ["sys-1"],
      }),
    ).resolves.toBe(false);
  });

  test("fails CLOSED when the assignment lookup errors", async () => {
    const auth = authWith({
      check: async () => ({ hasAccess: false }),
    });

    await expect(
      canReadConfigurationScope({
        auth,
        user: realUser([]),
        configurationId,
        getAssignedSystemIds: async () => {
          throw new Error("db down");
        },
      }),
    ).resolves.toBe(false);
  });
});
