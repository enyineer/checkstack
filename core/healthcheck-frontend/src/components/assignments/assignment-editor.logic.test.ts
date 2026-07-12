import { describe, expect, test } from "bun:test";
import {
  DEFAULT_NOTIFICATION_POLICY,
  DEFAULT_RETENTION_CONFIG,
} from "@checkstack/healthcheck-common";
import {
  buildAssociationBody,
  resolveNotificationPolicyView,
  seedRetentionData,
  seedSpecificEnvironmentIds,
  type AssignmentDetails,
} from "./assignment-editor.logic";

const CONFIG_ID = "cfg-1";

const baseAssignment: AssignmentDetails = {
  systemId: "sys-1",
  enabled: true,
  stateThresholds: undefined,
  satelliteIds: ["sat-1"],
  environmentIds: null,
  includeLocal: true,
  notificationPolicy: { suppressDeEscalations: true },
};

describe("buildAssociationBody", () => {
  test("carries every unpatched field over verbatim", () => {
    const body = buildAssociationBody({
      configurationId: CONFIG_ID,
      assignment: baseAssignment,
    });
    expect(body).toEqual({
      configurationId: CONFIG_ID,
      enabled: true,
      stateThresholds: undefined,
      satelliteIds: ["sat-1"],
      environmentIds: null,
      includeLocal: true,
      notificationPolicy: { suppressDeEscalations: true },
    });
  });

  test("applies a patch without touching other fields", () => {
    const body = buildAssociationBody({
      configurationId: CONFIG_ID,
      assignment: baseAssignment,
      patch: { enabled: false },
    });
    expect(body.enabled).toBe(false);
    expect(body.satelliteIds).toEqual(["sat-1"]);
    expect(body.includeLocal).toBe(true);
  });

  test("preserves the environmentIds null vs [] vs list distinction", () => {
    // null (all envs) survives untouched...
    expect(
      buildAssociationBody({
        configurationId: CONFIG_ID,
        assignment: baseAssignment,
      }).environmentIds,
    ).toBeNull();
    // ...[] (opt out) survives untouched...
    expect(
      buildAssociationBody({
        configurationId: CONFIG_ID,
        assignment: { ...baseAssignment, environmentIds: [] },
      }).environmentIds,
    ).toEqual([]);
    // ...and a patch can set either explicitly.
    expect(
      buildAssociationBody({
        configurationId: CONFIG_ID,
        assignment: baseAssignment,
        patch: { environmentIds: [] },
      }).environmentIds,
    ).toEqual([]);
    expect(
      buildAssociationBody({
        configurationId: CONFIG_ID,
        assignment: { ...baseAssignment, environmentIds: ["env-1"] },
        patch: { environmentIds: null },
      }).environmentIds,
    ).toBeNull();
  });

  test("a patch can explicitly clear notificationPolicy back to inherit", () => {
    const body = buildAssociationBody({
      configurationId: CONFIG_ID,
      assignment: baseAssignment,
      patch: { notificationPolicy: undefined },
    });
    expect(body.notificationPolicy).toBeUndefined();
  });
});

describe("resolveNotificationPolicyView", () => {
  const draft = { suppressDeEscalations: true };
  const persisted = { suppressDeEscalations: false };
  const defaults = { suppressDeEscalations: false };

  test("a draft wins and reads as overridden", () => {
    expect(
      resolveNotificationPolicyView({
        draft,
        persisted: undefined,
        platformDefaults: defaults,
      }),
    ).toEqual({ policy: draft, isOverridden: true });
  });

  test("a persisted override (no draft) wins and reads as overridden", () => {
    expect(
      resolveNotificationPolicyView({
        draft: undefined,
        persisted,
        platformDefaults: defaults,
      }),
    ).toEqual({ policy: persisted, isOverridden: true });
  });

  test("neither draft nor persisted inherits the platform defaults", () => {
    expect(
      resolveNotificationPolicyView({
        draft: undefined,
        persisted: undefined,
        platformDefaults: defaults,
      }),
    ).toEqual({ policy: defaults, isOverridden: false });
  });

  test("falls back to the built-in default when platform defaults are unreadable", () => {
    // A pure system manager cannot read the platform defaults (typeScoped) -
    // the view then falls back to the built-in constant, like the old page.
    expect(
      resolveNotificationPolicyView({
        draft: undefined,
        persisted: undefined,
        platformDefaults: undefined,
      }),
    ).toEqual({ policy: DEFAULT_NOTIFICATION_POLICY, isOverridden: false });
  });
});

describe("seedRetentionData", () => {
  test("a stored custom config seeds isCustom: true", () => {
    expect(
      seedRetentionData({
        rawRetentionDays: 3,
        hourlyRetentionDays: 14,
        dailyRetentionDays: 90,
      }),
    ).toEqual({
      rawRetentionDays: 3,
      hourlyRetentionDays: 14,
      dailyRetentionDays: 90,
      isCustom: true,
    });
  });

  test("null/absent seeds the defaults with isCustom: false", () => {
    for (const value of [null, undefined]) {
      expect(seedRetentionData(value)).toEqual({
        rawRetentionDays: DEFAULT_RETENTION_CONFIG.rawRetentionDays,
        hourlyRetentionDays: DEFAULT_RETENTION_CONFIG.hourlyRetentionDays,
        dailyRetentionDays: DEFAULT_RETENTION_CONFIG.dailyRetentionDays,
        isCustom: false,
      });
    }
  });
});

describe("seedSpecificEnvironmentIds", () => {
  const systemEnvironmentIds = ["env-1", "env-2"];

  test("keeps an existing explicit selection", () => {
    expect(
      seedSpecificEnvironmentIds({
        environmentIds: ["env-2"],
        systemEnvironmentIds,
      }),
    ).toEqual(["env-2"]);
  });

  test("null (all envs) and [] (opt out) both seed from the system's environments", () => {
    for (const environmentIds of [null, [] as string[], undefined]) {
      expect(
        seedSpecificEnvironmentIds({ environmentIds, systemEnvironmentIds }),
      ).toEqual(systemEnvironmentIds);
    }
  });
});
