/**
 * Cross-pod conversation readback (real Postgres) — matrix #15, plan §16,
 * state-and-scale §9.
 *
 * The DETERMINISTIC backstop the single-process unit suite cannot provide: "does
 * a read return the same answer on every pod?". A conversation created against
 * one connection pool MUST be readable, owner-scoped, via a SECOND pool over the
 * SAME Postgres — because the chat agent loop is resumable on whichever pod
 * handles the next turn, and nothing about a conversation is pod-local.
 *
 * Two-pod model (faithful proxy, mirrors `automation-backend`'s
 * `cross-pod-read-consistency.it.test.ts`): two independent `AiConversationStore`
 * instances, each over its OWN `pg.Pool`, BOTH pointed at the SAME schema.
 * Separate pools = no shared JS heap; one DB = the shared durable substrate N
 * pods share in production.
 *
 * NEGATIVE: a conversation owned by user A is NOT readable by user B from pod B
 * (the store is always owner-scoped, so it can never leak another user's chat).
 *
 * Gated behind `CHECKSTACK_IT=1`; connection from `CHECKSTACK_IT_PG_URL`. Runs in
 * a freshly created, self-cleaning schema.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { SafeDatabase } from "@checkstack/backend-api";
import * as schema from "../schema";
import {
  createAiConversationStore,
  type AiConversationStore,
} from "./conversation-store";

const PG_URL =
  process.env.CHECKSTACK_IT_PG_URL ??
  "postgres://postgres:postgres@localhost:5432/postgres";

const SCHEMA = `it_ai_conv_${crypto.randomUUID().replace(/-/g, "")}`;

interface Pod {
  pool: Pool;
  store: AiConversationStore;
  end(): Promise<void>;
}

function makePod(): Pod {
  const pool = new Pool({
    connectionString: PG_URL,
    options: `-c search_path=${SCHEMA}`,
  });
  const db = drizzle(pool, { schema }) as unknown as SafeDatabase<typeof schema>;
  return { pool, store: createAiConversationStore({ db }), end: () => pool.end() };
}

describe.skipIf(!process.env.CHECKSTACK_IT)(
  "cross-pod conversation readback (shared Postgres)",
  () => {
    let admin: Pool;
    let podA: Pod;
    let podB: Pod;

    beforeAll(async () => {
      admin = new Pool({ connectionString: PG_URL });
      await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
      await admin.query(`
        CREATE TABLE "${SCHEMA}".ai_conversations (
          id text PRIMARY KEY,
          user_id text NOT NULL,
          title text,
          integration_id text,
          model text,
          permission_mode text NOT NULL DEFAULT 'approve',
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now(),
          archived_at timestamp
        )
      `);
      await admin.query(`
        CREATE TABLE "${SCHEMA}".ai_messages (
          id text PRIMARY KEY,
          conversation_id text NOT NULL
            REFERENCES "${SCHEMA}".ai_conversations(id) ON DELETE CASCADE,
          role text NOT NULL,
          content jsonb NOT NULL,
          tool_calls jsonb,
          model_messages jsonb,
          created_at timestamp NOT NULL DEFAULT now()
        )
      `);
      podA = makePod();
      podB = makePod();
    });

    afterAll(async () => {
      await podA?.end();
      await podB?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.end();
    });

    it("a conversation created on pod A is fully readable on pod B (same owner)", async () => {
      const created = await podA.store.createConversation({
        userId: "user-A",
        title: "Investigate prod outage",
        integrationId: "ai.openai-compatible.c1",
        model: "gpt-4o-mini",
      });
      await podA.store.appendMessage({
        conversationId: created.id,
        role: "user",
        content: { text: "what changed in the last hour?" },
      });

      // Pod B — a DIFFERENT pool, no shared heap — reads the SAME conversation.
      const fetched = await podB.store.getConversation({
        id: created.id,
        userId: "user-A",
      });
      expect(fetched?.id).toBe(created.id);
      expect(fetched?.title).toBe("Investigate prod outage");
      expect(fetched?.model).toBe("gpt-4o-mini");

      // And the transcript continues correctly from pod B.
      const messages = await podB.store.listMessages({
        conversationId: created.id,
      });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toEqual({
        text: "what changed in the last hour?",
      });

      // A follow-up appended on pod B is visible back on pod A (resumable). The
      // assistant turn carries the canonical AI-SDK ResponseMessage[] for
      // tool-call REPLAY — it must round-trip cross-pod so the next turn on any
      // pod replays the prior tool interaction (state-and-scale §9).
      await podB.store.appendMessage({
        conversationId: created.id,
        role: "assistant",
        content: { text: "a deploy at 14:02" },
        modelMessages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "tc1",
                toolName: "incident.list",
                input: { status: "open" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "tc1",
                toolName: "incident.list",
                output: { type: "json", value: { rows: [] } },
              },
            ],
          },
        ],
      });
      const fromA = await podA.store.listMessages({ conversationId: created.id });
      expect(fromA.map((m) => m.role)).toEqual(["user", "assistant"]);
      // The replay history written on pod B is fully readable on pod A.
      const assistant = fromA[1];
      expect(assistant?.modelMessages).toHaveLength(2);
      expect(assistant?.modelMessages?.[0]?.role).toBe("assistant");
      expect(assistant?.modelMessages?.[1]?.role).toBe("tool");
    });

    it("NEGATIVE: pod B cannot read user A's conversation as a DIFFERENT user", async () => {
      const created = await podA.store.createConversation({
        userId: "user-A",
        title: "private",
      });

      // User B asks pod B for the row by id — owner-scoped read returns nothing.
      const leaked = await podB.store.getConversation({
        id: created.id,
        userId: "user-B",
      });
      expect(leaked).toBeUndefined();

      // User B's list never includes it either.
      const listB = await podB.store.listConversations({ userId: "user-B" });
      expect(listB.find((c) => c.id === created.id)).toBeUndefined();

      // And user B cannot delete it (owner-scoped) — the row survives.
      const deleted = await podB.store.deleteConversation({
        id: created.id,
        userId: "user-B",
      });
      expect(deleted).toBe(false);
      const stillThere = await podA.store.getConversation({
        id: created.id,
        userId: "user-A",
      });
      expect(stillThere?.id).toBe(created.id);
    });
  },
);
