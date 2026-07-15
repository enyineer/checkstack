import type { SafeDatabase } from "@checkstack/backend-api";
import { eq } from "drizzle-orm";
import {
  TraceStreamConfigSchema,
  type TraceStream,
} from "@checkstack/tracestream-common";
import * as schema from "../../schema";
import { traceStreams } from "../../schema";
import type { StreamStore } from "../ports";

type Db = SafeDatabase<typeof schema>;

type StreamRow = typeof traceStreams.$inferSelect;

function mapRow(row: StreamRow): TraceStream {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config: TraceStreamConfigSchema.parse(row.config ?? {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createStreamStore({ db }: { db: Db }): StreamStore {
  return {
    async listPolicies() {
      const rows = await db
        .select({ id: traceStreams.id, config: traceStreams.config })
        .from(traceStreams);
      return rows.map((row) => ({
        streamId: row.id,
        config: TraceStreamConfigSchema.parse(row.config ?? {}),
      }));
    },

    async list() {
      const rows = await db.select().from(traceStreams);
      return rows.map((row) => mapRow(row));
    },

    async listForPicker() {
      return db
        .select({ id: traceStreams.id, name: traceStreams.name })
        .from(traceStreams);
    },

    async get({ id }) {
      const [row] = await db
        .select()
        .from(traceStreams)
        .where(eq(traceStreams.id, id))
        .limit(1);
      return row ? mapRow(row) : null;
    },

    async create({ name, description, config }) {
      const id = crypto.randomUUID();
      const now = new Date();
      const parsed = TraceStreamConfigSchema.parse(config ?? {});
      const [row] = await db
        .insert(traceStreams)
        .values({
          id,
          name,
          description: description ?? null,
          config: parsed,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return mapRow(row);
    },

    async update({ id, name, description, config }) {
      const [existing] = await db
        .select()
        .from(traceStreams)
        .where(eq(traceStreams.id, id))
        .limit(1);
      if (!existing) return null;
      // Merge the partial config over the stored policy, then re-parse so every
      // field stays defaulted and validated.
      const nextConfig = config
        ? TraceStreamConfigSchema.parse({ ...existing.config, ...config })
        : existing.config;
      const [row] = await db
        .update(traceStreams)
        .set({
          ...(name === undefined ? {} : { name }),
          ...(description === undefined
            ? {}
            : { description: description ?? null }),
          config: nextConfig,
          updatedAt: new Date(),
        })
        .where(eq(traceStreams.id, id))
        .returning();
      return row ? mapRow(row) : null;
    },

    async delete({ id }) {
      await db.delete(traceStreams).where(eq(traceStreams.id, id));
    },
  };
}
