import { describe, it, expect, mock } from "bun:test";
import { createAutomationStore } from "./automation-store";

/**
 * Minimal valid definition JSON for rows returned by mocked queries
 * (`mapToAutomation` parses it).
 */
const DEFINITION = {
  name: "n",
  triggers: [{ event: "incident.incident.created" }],
  conditions: [],
  actions: [],
  mode: "single",
  concurrency_scope: "automation",
  max_runs: 10,
};

function row(overrides: Record<string, unknown>) {
  return {
    id: "a1",
    name: "A1",
    description: null,
    group: null,
    status: "enabled",
    definition: DEFINITION,
    managedBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("automation-store create", () => {
  it("persists the group column from the input", async () => {
    const values = mock((_v: Record<string, unknown>) => ({
      returning: mock(() => Promise.resolve([row({ group: "Alerting" })])),
    }));
    const db = { insert: mock(() => ({ values })) };
    const store = createAutomationStore(db as never);

    const result = await store.create({
      name: "A1",
      group: "Alerting",
      status: "enabled",
      definition: DEFINITION as never,
      runAs: "app-test",
    });

    const inserted = values.mock.calls[0]?.[0] as { group: string | null };
    expect(inserted.group).toBe("Alerting");
    expect(result.group).toBe("Alerting");
  });

  it("inserts null group when none is provided", async () => {
    const values = mock((_v: Record<string, unknown>) => ({
      returning: mock(() => Promise.resolve([row({ group: null })])),
    }));
    const db = { insert: mock(() => ({ values })) };
    const store = createAutomationStore(db as never);

    await store.create({
      name: "A1",
      status: "enabled",
      definition: DEFINITION as never,
      runAs: "app-test",
    });

    const inserted = values.mock.calls[0]?.[0] as { group: string | null };
    expect(inserted.group).toBeNull();
  });
});

describe("automation-store update set-builder", () => {
  function updateDb(returned: Record<string, unknown>) {
    // getById (select…limit) then update (set…where…returning).
    const select = mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve([row({})])),
        })),
      })),
    }));
    const set = mock((_v: Record<string, unknown>) => ({
      where: mock(() => ({
        returning: mock(() => Promise.resolve([row(returned)])),
      })),
    }));
    const db = { select, update: mock(() => ({ set })) };
    return { db, set };
  }

  it("sets the group when a string is given", async () => {
    const { db, set } = updateDb({ group: "Networking" });
    const store = createAutomationStore(db as never);
    await store.update({ id: "a1", group: "Networking" });
    const patch = set.mock.calls[0]?.[0] as { group?: string | null };
    expect(patch.group).toBe("Networking");
  });

  it("clears the group when null is given", async () => {
    const { db, set } = updateDb({ group: null });
    const store = createAutomationStore(db as never);
    await store.update({ id: "a1", group: null });
    const patch = set.mock.calls[0]?.[0] as { group?: string | null };
    expect(patch.group).toBeNull();
  });

  it("leaves the group untouched when omitted", async () => {
    const { db, set } = updateDb({ group: "Existing" });
    const store = createAutomationStore(db as never);
    await store.update({ id: "a1", name: "renamed" });
    const patch = set.mock.calls[0]?.[0] as { group?: string | null };
    expect("group" in patch).toBe(false);
  });
});

describe("automation-store listGroups", () => {
  it("returns the distinct non-null group values produced by the query", async () => {
    const where = mock(() => ({
      orderBy: mock(() =>
        Promise.resolve([{ group: "Alerting" }, { group: "Networking" }]),
      ),
    }));
    const db = {
      selectDistinct: mock(() => ({ from: mock(() => ({ where })) })),
    };
    const store = createAutomationStore(db as never);
    const groups = await store.listGroups();
    expect(groups).toEqual(["Alerting", "Networking"]);
  });

  it("filters out any null group that slips through", async () => {
    const where = mock(() => ({
      orderBy: mock(() =>
        Promise.resolve([{ group: "Alerting" }, { group: null }]),
      ),
    }));
    const db = {
      selectDistinct: mock(() => ({ from: mock(() => ({ where })) })),
    };
    const store = createAutomationStore(db as never);
    const groups = await store.listGroups();
    expect(groups).toEqual(["Alerting"]);
  });
});
