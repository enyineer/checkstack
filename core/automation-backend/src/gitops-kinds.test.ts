import { describe, it, expect, mock } from "bun:test";
import {
  deleteAutomationEntity,
  GITOPS_MANAGED_BY,
  reconcileAutomation,
} from "./gitops-kinds";

const logger = { info: () => {} };

const spec = {
  name: "Notify on incident",
  triggers: [{ event: "incident.created" }],
  conditions: [],
  actions: [{ action: "automation.log", config: { message: "hi" } }],
  mode: "single",
  max_runs: 10,
};

function insertMockDb(newId: string) {
  const values = mock((_input: Record<string, unknown>) => ({
    returning: mock(() => Promise.resolve([{ id: newId }])),
  }));
  return { db: { insert: mock(() => ({ values })) }, values };
}

function updateMockDb(rows: Array<{ id: string }>) {
  const set = mock((_input: Record<string, unknown>) => ({
    where: mock(() => ({ returning: mock(() => Promise.resolve(rows)) })),
  }));
  return { db: { update: mock(() => ({ set })) }, set };
}

describe("reconcileAutomation", () => {
  it("creates a new automation on first reconcile, tagging managed_by=gitops", async () => {
    const { db, values } = insertMockDb("auto-1");
    const result = await reconcileAutomation(db as never, {
      entity: { metadata: { name: "notify" }, spec: spec as never },
      logger,
    });
    expect(result.entityId).toBe("auto-1");
    const inserted = values.mock.calls[0]?.[0] as unknown as {
      managedBy: string;
      name: string;
      status: string;
    };
    expect(inserted.managedBy).toBe(GITOPS_MANAGED_BY);
    expect(inserted.status).toBe("enabled");
  });

  it("uses metadata.title for the name when present", async () => {
    const { db, values } = insertMockDb("auto-1");
    await reconcileAutomation(db as never, {
      entity: {
        metadata: { name: "notify", title: "Notify on incident" },
        spec: spec as never,
      },
      logger,
    });
    const inserted = values.mock.calls[0]?.[0] as unknown as { name: string };
    expect(inserted.name).toBe("Notify on incident");
  });

  it("updates in place when an existingEntityId is given", async () => {
    const { db, set } = updateMockDb([{ id: "auto-1" }]);
    const result = await reconcileAutomation(db as never, {
      entity: { metadata: { name: "notify" }, spec: spec as never },
      existingEntityId: "auto-1",
      logger,
    });
    expect(result.entityId).toBe("auto-1");
    const updated = set.mock.calls[0]?.[0] as unknown as { managedBy: string };
    expect(updated.managedBy).toBe(GITOPS_MANAGED_BY);
  });

  it("falls back to insert when the existing row has vanished", async () => {
    // update returns no rows → re-create
    const set = mock(() => ({
      where: mock(() => ({ returning: mock(() => Promise.resolve([])) })),
    }));
    const values = mock(() => ({
      returning: mock(() => Promise.resolve([{ id: "auto-new" }])),
    }));
    const db = {
      update: mock(() => ({ set })),
      insert: mock(() => ({ values })),
    };
    const result = await reconcileAutomation(db as never, {
      entity: { metadata: { name: "notify" }, spec: spec as never },
      existingEntityId: "gone",
      logger,
    });
    expect(result.entityId).toBe("auto-new");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("carries the group from metadata.labels.group on insert", async () => {
    const { db, values } = insertMockDb("auto-1");
    await reconcileAutomation(db as never, {
      entity: {
        metadata: { name: "notify", labels: { group: "Alerting" } },
        spec: spec as never,
      },
      logger,
    });
    const inserted = values.mock.calls[0]?.[0] as unknown as { group: string };
    expect(inserted.group).toBe("Alerting");
  });

  it("carries the group from metadata.labels.group on update", async () => {
    const { db, set } = updateMockDb([{ id: "auto-1" }]);
    await reconcileAutomation(db as never, {
      entity: {
        metadata: { name: "notify", labels: { group: "Networking" } },
        spec: spec as never,
      },
      existingEntityId: "auto-1",
      logger,
    });
    const updated = set.mock.calls[0]?.[0] as unknown as { group: string };
    expect(updated.group).toBe("Networking");
  });

  it("sets group to null when the label is absent or blank", async () => {
    const { db, values } = insertMockDb("auto-1");
    await reconcileAutomation(db as never, {
      entity: {
        metadata: { name: "notify", labels: { group: "  " } },
        spec: spec as never,
      },
      logger,
    });
    const inserted = values.mock.calls[0]?.[0] as unknown as {
      group: string | null;
    };
    expect(inserted.group).toBeNull();
  });

  it("fills schema defaults (mode / concurrency_scope) from the spec", async () => {
    const { db, values } = insertMockDb("auto-1");
    await reconcileAutomation(db as never, {
      // spec omits mode/concurrency_scope → defaults applied on parse.
      entity: {
        metadata: { name: "notify" },
        spec: {
          name: "x",
          triggers: [{ event: "incident.created" }],
          actions: [],
        } as never,
      },
      logger,
    });
    const inserted = values.mock.calls[0]?.[0] as unknown as {
      definition: { mode: string; concurrency_scope: string };
    };
    expect(inserted.definition.mode).toBe("single");
    expect(inserted.definition.concurrency_scope).toBe("automation");
  });
});

describe("deleteAutomationEntity", () => {
  it("deletes the row (guarded to managed_by=gitops)", async () => {
    const where = mock(() => Promise.resolve());
    const db = { delete: mock(() => ({ where })) };
    await deleteAutomationEntity(db as never, { entityId: "auto-1", logger });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("no-ops when no entityId is given", async () => {
    const db = { delete: mock(() => ({ where: mock() })) };
    await deleteAutomationEntity(db as never, { logger });
    expect(db.delete).not.toHaveBeenCalled();
  });
});
