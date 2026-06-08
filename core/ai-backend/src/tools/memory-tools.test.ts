import { describe, expect, test, mock } from "bun:test";
import type { AuthUser } from "@checkstack/backend-api";
import { createMemoryTools } from "./memory-tools";
import type { AiMemoryStore } from "../memory-store";
import type { AiMemoryRow } from "../schema";
import type { SystemAccessResolver } from "../system-signals-contributor";
import {
  memorySaveAllowed,
  MAX_MEMORY_SAVES_PER_RUN,
} from "../agent-runner";

function user(accessRules: string[] = []): AuthUser {
  return { type: "user", id: "u1", accessRules } as AuthUser;
}

function row(over: Partial<AiMemoryRow> = {}): AiMemoryRow {
  return {
    id: "m1",
    ownerId: "u1",
    scope: "user",
    systemId: null,
    recallHint: "hint",
    content: "content",
    alwaysInject: false,
    tags: null,
    sourceConversationId: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...over,
  };
}

/** A store whose methods are mocks; override per test. */
function fakeStore(over: Partial<AiMemoryStore> = {}): AiMemoryStore {
  return {
    saveOrUpdate: mock(async () => ({ row: row(), updated: false })),
    findDuplicate: mock(async () => undefined),
    search: mock(async () => []),
    list: mock(async () => []),
    delete: mock(async () => true),
    systemIdsWithMemories: mock(async () => []),
    findById: mock(async () => undefined),
    listAlwaysInject: mock(async () => []),
    setAlwaysInject: mock(async () => true),
    ...over,
  };
}

/** A resolver that grants access to exactly `allowed` system ids. */
function fakeResolver(allowed: string[]): SystemAccessResolver {
  return {
    accessibleSystemIds: mock(async ({ systemIds }: { systemIds: string[] }) =>
      systemIds.filter((id) => allowed.includes(id)),
    ),
  };
}

function tools(store: AiMemoryStore, resolver: SystemAccessResolver) {
  const list = createMemoryTools({ store, resolver });
  const byName = (n: string) => list.find((t) => t.name === n)!;
  return {
    search: byName("ai.searchMemory"),
    save: byName("ai.saveMemory"),
    del: byName("ai.deleteMemory"),
  };
}

describe("memory tool effects + gating (drives chat/agent offering)", () => {
  test("effects classify the tools so the agent runner offers search+save, withholds delete", () => {
    const { search, save, del } = tools(fakeStore(), fakeResolver([]));
    expect(search.effect).toBe("read");
    expect(save.effect).toBe("mutate");
    // destructive => the runner's `effect !== "destructive"` filter excludes it.
    expect(del.effect).toBe("destructive");
  });

  test("tools carry the dedicated memory access rules, not the chat gate", () => {
    const { search, save, del } = tools(fakeStore(), fakeResolver([]));
    expect(search.requiredAccessRules).toEqual(["ai.memory.read"]);
    expect(save.requiredAccessRules).toEqual(["ai.memory.manage"]);
    expect(del.requiredAccessRules).toEqual(["ai.memory.manage"]);
  });
});

describe("searchMemory recall scoping", () => {
  test("passes the owner id and only the readable systems to the store", async () => {
    const store = fakeStore({
      systemIdsWithMemories: mock(async () => ["sysA", "sysB"]),
      search: mock(async () => [row({ scope: "system", systemId: "sysA" })]),
    });
    // The user can read only sysA.
    const { search } = tools(store, fakeResolver(["sysA"]));
    await search.execute({
      input: { query: "anything" },
      principal: user(),
      rpcClient: {} as never,
    });
    // Only the readable system (sysA, not sysB) is passed through to the store.
    expect(store.search).toHaveBeenCalledWith({
      ownerId: "u1",
      readableSystemIds: ["sysA"],
      query: "anything",
      limit: undefined,
    });
  });
});

describe("saveMemory system-scope authority", () => {
  test("rejects a system write to a system the caller cannot access", async () => {
    const store = fakeStore();
    const { save } = tools(store, fakeResolver([])); // no access to any system
    await expect(
      save.execute({
        input: { scope: "system", systemId: "sysX", recallHint: "h", content: "c" },
        principal: user(),
        rpcClient: {} as never,
      }),
    ).rejects.toThrow(/do not have access/);
    expect(store.saveOrUpdate).not.toHaveBeenCalled();
  });

  test("allows a system write when the caller can read the system", async () => {
    const store = fakeStore();
    const { save } = tools(store, fakeResolver(["sysX"]));
    await save.execute({
      input: { scope: "system", systemId: "sysX", recallHint: "h", content: "c" },
      principal: user(),
      rpcClient: {} as never,
    });
    expect(store.saveOrUpdate).toHaveBeenCalledTimes(1);
  });

  test("forwards the model's alwaysInject choice to the store", async () => {
    const store = fakeStore();
    const { save } = tools(store, fakeResolver([]));
    await save.execute({
      input: { scope: "user", recallHint: "h", content: "c", alwaysInject: true },
      principal: user(),
      rpcClient: {} as never,
    });
    expect(store.saveOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ alwaysInject: true }),
    );
  });
});

describe("deleteMemory authority", () => {
  test("resolves manageable systems for a system memory and delegates to the store", async () => {
    const store = fakeStore({
      findById: mock(async () => row({ id: "m9", scope: "system", systemId: "sysA" })),
    });
    const { del } = tools(store, fakeResolver(["sysA"])); // can manage sysA
    await del.execute({
      input: { id: "m9" },
      principal: user(),
      rpcClient: {} as never,
    });
    expect(store.delete).toHaveBeenCalledWith({
      id: "m9",
      ownerId: "u1",
      manageableSystemIds: ["sysA"],
    });
  });

  test("a user memory carries no manageable systems (owner check only)", async () => {
    const store = fakeStore({
      findById: mock(async () => row({ id: "m1", scope: "user", systemId: null })),
    });
    const { del } = tools(store, fakeResolver([]));
    await del.execute({
      input: { id: "m1" },
      principal: user(),
      rpcClient: {} as never,
    });
    expect(store.delete).toHaveBeenCalledWith({
      id: "m1",
      ownerId: "u1",
      manageableSystemIds: [],
    });
  });
});

describe("per-run memory save cap (unattended agent)", () => {
  test("allows up to the cap, then blocks", () => {
    expect(memorySaveAllowed(0)).toBe(true);
    expect(memorySaveAllowed(MAX_MEMORY_SAVES_PER_RUN - 1)).toBe(true);
    expect(memorySaveAllowed(MAX_MEMORY_SAVES_PER_RUN)).toBe(false);
  });
});
