import { describe, it, expect } from "bun:test";
import {
  createMockLogger,
  createMockSignalService,
} from "@checkstack/test-utils-backend";
import type { SafeDatabase } from "@checkstack/backend-api";
import { LOGSTREAM_IMPORTANT_EVENT } from "@checkstack/logstream-common";
import { createImportantEventRecorder } from "./recorder";
import type * as schema from "../schema";

/** Minimal insert-capturing db stub (the recorder only inserts). */
function makeCapturingDb() {
  const inserts: Array<Record<string, unknown>> = [];
  const db = {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve();
      },
    }),
  };
  return {
    db: db as unknown as SafeDatabase<typeof schema>,
    inserts,
  };
}

describe("createImportantEventRecorder", () => {
  it("persists the event and broadcasts the signal", async () => {
    const { db, inserts } = makeCapturingDb();
    const signalService = createMockSignalService();
    const recorder = createImportantEventRecorder({
      db,
      signalService,
      logger: createMockLogger(),
    });

    const ts = new Date("2026-07-12T10:00:00Z");
    const event = await recorder.record({
      streamId: "s1",
      ts,
      type: "spike",
      severityNumber: 18,
      patternId: "p1",
      title: "Error spike",
      detail: { count: 42 },
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      streamId: "s1",
      type: "spike",
      severityNumber: 18,
      patternId: "p1",
      title: "Error spike",
    });
    expect(event.id).toBeTruthy();
    expect(event.createdAt).toBeInstanceOf(Date);

    const broadcasts = signalService.getRecordedSignalsById(
      LOGSTREAM_IMPORTANT_EVENT.id,
    );
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].payload).toMatchObject({
      streamId: "s1",
      type: "spike",
      title: "Error spike",
      patternId: "p1",
    });
  });

  it("still commits the write when the signal broadcast throws", async () => {
    const { db, inserts } = makeCapturingDb();
    const logger = createMockLogger();
    // A signal service whose broadcast rejects: the bus is down, but the
    // important-event row must still be persisted and the call must resolve.
    const signalService = createMockSignalService();
    signalService.broadcast = () =>
      Promise.reject(new Error("signal bus unavailable"));

    const recorder = createImportantEventRecorder({ db, signalService, logger });

    const event = await recorder.record({
      streamId: "s1",
      ts: new Date("2026-07-12T10:00:00Z"),
      type: "spike",
      title: "Error spike",
    });

    // The write happened and a well-formed event was returned despite the throw.
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ streamId: "s1", type: "spike" });
    expect(event.id).toBeTruthy();
    // The failure was swallowed and logged as a warning, not rethrown.
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("nulls optional fields when absent", async () => {
    const { db, inserts } = makeCapturingDb();
    const recorder = createImportantEventRecorder({
      db,
      signalService: createMockSignalService(),
      logger: createMockLogger(),
    });

    await recorder.record({
      streamId: "s2",
      ts: new Date(),
      type: "silence",
      title: "No logs for 15m",
    });

    expect(inserts[0]).toMatchObject({
      severityNumber: null,
      patternId: null,
      detail: null,
    });
  });
});
