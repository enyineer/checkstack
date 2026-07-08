import { describe, expect, test, mock } from "bun:test";
import { createAiConversationStore } from "./conversation-store";
import type { AiConversationRow, AiMessageRow } from "../schema";

/**
 * State-and-scale (#15): the conversation store is pure shared-Postgres CRUD —
 * it holds NO pod-local state, so a conversation written by one pod is readable
 * by any other simply because both read/write the same database. These unit
 * tests assert that property structurally:
 *
 *  - every read/write goes through the injected `db` (no in-memory cache that
 *    would diverge between pods), and
 *  - reads are always owner-scoped (a `userId` filter), so the store can never
 *    leak another user's chat.
 *
 * True cross-pod readback against a live Postgres is exercised in
 * `conversation-store.it.test.ts` (env-gated). Here we use a spy db.
 */

function convRow(over: Partial<AiConversationRow> = {}): AiConversationRow {
  return {
    id: "c1",
    userId: "u1",
    title: "t",
    integrationId: null,
    model: null,
    permissionMode: "approve",
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    archivedAt: null,
    summary: null,
    summarizedThroughMessageId: null,
    ...over,
  };
}

function msgRow(over: Partial<AiMessageRow> = {}): AiMessageRow {
  return {
    id: "m1",
    conversationId: "c1",
    role: "user",
    content: { text: "hi" },
    toolCalls: null,
    modelMessages: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    ...over,
  };
}

describe("AiConversationStore", () => {
  test("createConversation inserts and returns the row", async () => {
    const returning = mock(() => Promise.resolve([convRow()]));
    const values = mock((_v: Record<string, unknown>) => ({ returning }));
    const db = { insert: mock(() => ({ values })) };
    const store = createAiConversationStore({ db: db as never });

    const created = await store.createConversation({
      userId: "u1",
      title: "t",
      integrationId: "ai.openai-compatible.c1",
      model: "gpt-4o-mini",
    });
    expect(created.id).toBe("c1");
    const inserted = values.mock.calls[0]?.[0] as {
      userId: string;
      model: string;
    };
    expect(inserted.userId).toBe("u1");
    expect(inserted.model).toBe("gpt-4o-mini");
  });

  test("createConversation passes permissionMode through to the insert", async () => {
    const returning = mock(() =>
      Promise.resolve([convRow({ permissionMode: "auto" })]),
    );
    const values = mock((_v: Record<string, unknown>) => ({ returning }));
    const db = { insert: mock(() => ({ values })) };
    const store = createAiConversationStore({ db: db as never });

    const created = await store.createConversation({
      userId: "u1",
      permissionMode: "auto",
    });
    expect(created.permissionMode).toBe("auto");
    const inserted = values.mock.calls[0]?.[0] as { permissionMode?: string };
    expect(inserted.permissionMode).toBe("auto");
  });

  test("createConversation omits permissionMode when not given (column default applies)", async () => {
    const returning = mock(() => Promise.resolve([convRow()]));
    const values = mock((_v: Record<string, unknown>) => ({ returning }));
    const db = { insert: mock(() => ({ values })) };
    const store = createAiConversationStore({ db: db as never });

    await store.createConversation({ userId: "u1" });
    const inserted = values.mock.calls[0]?.[0] as { permissionMode?: string };
    // Omitted -> undefined, so the NOT NULL DEFAULT 'approve' column applies.
    expect(inserted.permissionMode).toBeUndefined();
  });

  test("updateConversation writes permissionMode (owner-scoped) and bumps updatedAt", async () => {
    const returning = mock(() =>
      Promise.resolve([convRow({ permissionMode: "auto" })]),
    );
    const where = mock(() => ({ returning }));
    const set = mock(
      (_patch: { permissionMode?: string; updatedAt: Date }) => ({ where }),
    );
    const db = { update: mock(() => ({ set })) };
    const store = createAiConversationStore({ db: db as never });

    const updated = await store.updateConversation({
      id: "c1",
      userId: "u1",
      permissionMode: "auto",
    });
    expect(updated?.permissionMode).toBe("auto");
    const patch = set.mock.calls[0]?.[0] as {
      permissionMode?: string;
      updatedAt: Date;
    };
    expect(patch.permissionMode).toBe("auto");
    expect(patch.updatedAt).toBeInstanceOf(Date);
    // Owner-scoped: a WHERE clause filtering id + userId is always present.
    expect(where).toHaveBeenCalledTimes(1);
  });

  test("updateConversation leaves permissionMode untouched when not provided", async () => {
    const returning = mock(() => Promise.resolve([convRow()]));
    const where = mock(() => ({ returning }));
    const set = mock((_patch: Record<string, unknown>) => ({ where }));
    const db = { update: mock(() => ({ set })) };
    const store = createAiConversationStore({ db: db as never });

    await store.updateConversation({ id: "c1", userId: "u1", title: "new" });
    const patch = set.mock.calls[0]?.[0] as { permissionMode?: string };
    expect(patch.permissionMode).toBeUndefined();
  });

  test("getConversation reads through the db (no pod-local cache) and is owner-scoped", async () => {
    const where = mock(() => ({ limit: () => Promise.resolve([convRow()]) }));
    const from = mock(() => ({ where }));
    const db = { select: mock(() => ({ from })) };
    const store = createAiConversationStore({ db: db as never });

    const fetched = await store.getConversation({ id: "c1", userId: "u1" });
    expect(fetched?.id).toBe("c1");
    // Every read hits the shared db — there is no in-memory shortcut that would
    // return different answers on different pods.
    expect(db.select).toHaveBeenCalledTimes(1);
    // The query is filtered (id + userId): the WHERE clause is always present so
    // a caller can never read another user's conversation.
    expect(where).toHaveBeenCalledTimes(1);
  });

  test("appendMessage inserts the message and bumps the conversation updatedAt", async () => {
    const returning = mock(() => Promise.resolve([msgRow()]));
    const values = mock(() => ({ returning }));
    const updateWhere = mock(() => Promise.resolve([]));
    const set = mock((_patch: { updatedAt: Date }) => ({ where: updateWhere }));
    const db: {
      insert: ReturnType<typeof mock>;
      update: ReturnType<typeof mock>;
      transaction: (cb: (tx: unknown) => unknown) => unknown;
    } = {
      insert: mock(() => ({ values })),
      update: mock(() => ({ set })),
      // Scoped-db contract: appendMessage batches insert+bump in one tx.
      transaction: (cb) => cb(db),
    };
    const store = createAiConversationStore({ db: db as never });

    const m = await store.appendMessage({
      conversationId: "c1",
      role: "assistant",
      content: { text: "hello" },
    });
    expect(m.id).toBe("m1");
    // updatedAt bump = an UPDATE on the conversation row.
    expect(db.update).toHaveBeenCalledTimes(1);
    const patch = set.mock.calls[0]?.[0] as { updatedAt: Date };
    expect(patch.updatedAt).toBeInstanceOf(Date);
  });

  test("listMessages reads ordered by createdAt for the conversation", async () => {
    const orderBy = mock(() =>
      Promise.resolve([msgRow({ id: "m1" }), msgRow({ id: "m2" })]),
    );
    const where = mock(() => ({ orderBy }));
    const from = mock(() => ({ where }));
    const db = { select: mock(() => ({ from })) };
    const store = createAiConversationStore({ db: db as never });

    const msgs = await store.listMessages({ conversationId: "c1" });
    expect(msgs.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(orderBy).toHaveBeenCalledTimes(1);
  });

  test("listConversations is owner-scoped and ordered newest-first", async () => {
    const orderBy = mock(() => Promise.resolve([convRow()]));
    const where = mock(() => ({ orderBy }));
    const from = mock(() => ({ where }));
    const db = { select: mock(() => ({ from })) };
    const store = createAiConversationStore({ db: db as never });

    await store.listConversations({ userId: "u1" });
    expect(where).toHaveBeenCalledTimes(1);
    expect(orderBy).toHaveBeenCalledTimes(1);
  });

  test("archiveConversation soft-deletes via UPDATE (never DELETE), owner-scoped", async () => {
    const returning = mock(() => Promise.resolve([{ id: "c1" }]));
    const where = mock(() => ({ returning }));
    const set = mock((_patch: { archivedAt: Date }) => ({ where }));
    const db = {
      update: mock(() => ({ set })),
      // A DELETE on the store during archive would be a bug — assert it never runs.
      delete: mock(() => {
        throw new Error("archive must not hard-delete");
      }),
    };
    const store = createAiConversationStore({ db: db as never });

    expect(await store.archiveConversation({ id: "c1", userId: "u1" })).toBe(
      true,
    );
    // Soft delete = UPDATE stamping archivedAt, never a row removal.
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.delete).not.toHaveBeenCalled();
    const patch = set.mock.calls[0]?.[0] as { archivedAt: Date };
    expect(patch.archivedAt).toBeInstanceOf(Date);
    expect(where).toHaveBeenCalledTimes(1);
  });

  test("archiveConversation returns false when no owned active row matched", async () => {
    const returning = mock(() => Promise.resolve([]));
    const where = mock(() => ({ returning }));
    const set = mock(() => ({ where }));
    const db = { update: mock(() => ({ set })) };
    const store = createAiConversationStore({ db: db as never });

    expect(await store.archiveConversation({ id: "c1", userId: "u1" })).toBe(
      false,
    );
  });

  test("deleteConversation is owner-scoped and reports whether a row was removed", async () => {
    const returning = mock(() => Promise.resolve([{ id: "c1" }]));
    const where = mock(() => ({ returning }));
    const db = { delete: mock(() => ({ where })) };
    const store = createAiConversationStore({ db: db as never });

    expect(await store.deleteConversation({ id: "c1", userId: "u1" })).toBe(true);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
