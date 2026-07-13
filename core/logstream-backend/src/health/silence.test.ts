import { describe, it, expect, mock } from "bun:test";
import type { SafeDatabase, Logger } from "@checkstack/backend-api";
import type { Storage } from "../storage";
import type { ImportantEventRecorder } from "../events/recorder";
import * as schema from "../schema";
import { classifySilence, runSilenceDetection, SILENCE_THRESHOLD_MS } from "./silence";

const now = new Date("2026-01-01T12:00:00.000Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("classifySilence", () => {
  it("emits a silence event once the threshold is crossed with no marker", () => {
    expect(
      classifySilence({
        lastReceivedAt: minsAgo(16),
        silenceEventAt: null,
        now,
      }),
    ).toBe("emit_silence");
  });

  it("does not re-emit while the marker is already set (dedupe)", () => {
    expect(
      classifySilence({
        lastReceivedAt: minsAgo(30),
        silenceEventAt: minsAgo(14),
        now,
      }),
    ).toBe("none");
  });

  it("emits recovery when lines resume and a marker is set", () => {
    expect(
      classifySilence({
        lastReceivedAt: minsAgo(1),
        silenceEventAt: minsAgo(20),
        now,
      }),
    ).toBe("emit_recovered");
  });

  it("stays quiet for an active stream with no marker", () => {
    expect(
      classifySilence({
        lastReceivedAt: minsAgo(2),
        silenceEventAt: null,
        now,
      }),
    ).toBe("none");
  });

  it("does not treat a never-received stream as silent", () => {
    expect(
      classifySilence({
        lastReceivedAt: null,
        silenceEventAt: null,
        now,
      }),
    ).toBe("none");
  });

  it("uses a 15-minute default threshold", () => {
    expect(SILENCE_THRESHOLD_MS).toBe(15 * 60 * 1000);
    // Exactly at the threshold counts as silent (>=).
    expect(
      classifySilence({
        lastReceivedAt: new Date(now.getTime() - SILENCE_THRESHOLD_MS),
        silenceEventAt: null,
        now,
      }),
    ).toBe("emit_silence");
  });
});

// A single mutable activity row, plus the fakes runSilenceDetection touches.
interface ActivityRow {
  streamId: string;
  lastReceivedAt: Date | null;
  silenceEventAt: Date | null;
}

const noopLogger: Logger = {
  info() {},
  error() {},
  warn() {},
  debug() {},
};

/** Fake db that yields the shared `row` from the single activity SELECT. */
function fakeDb(row: ActivityRow): SafeDatabase<typeof schema> {
  const fake = {
    select: () => ({ from: () => Promise.resolve([row]) }),
  };
  // The db double only satisfies the one `select(...).from(activity)` call the
  // orchestration makes; the full SafeDatabase surface is irrelevant here.
  return fake as unknown as SafeDatabase<typeof schema>;
}

describe("runSilenceDetection orchestration", () => {
  it("sets the marker after emitting, so a second pass does NOT re-emit", async () => {
    const row: ActivityRow = {
      streamId: "s1",
      lastReceivedAt: minsAgo(20), // silent
      silenceEventAt: null,
    };
    const record = mock(async (_event: { streamId: string; type: string }) => {});
    const recorder = { record } as unknown as ImportantEventRecorder;
    // A faithful marker: persist what the job writes so the next SELECT sees it.
    const storage = {
      setSilenceMarker: mock(
        async ({ silenceEventAt }: { silenceEventAt: Date | null }) => {
          row.silenceEventAt = silenceEventAt;
        },
      ),
    } as unknown as Storage;

    const db = fakeDb(row);
    await runSilenceDetection({ db, storage, recorder, logger: noopLogger, now });
    await runSilenceDetection({ db, storage, recorder, logger: noopLogger, now });

    // First pass emits + sets the marker; second pass sees the marker → nothing.
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      streamId: "s1",
      type: "silence",
    });
    expect(row.silenceEventAt).toEqual(now);
  });

  it("re-emits when the marker write is dropped (the marker is what dedupes)", async () => {
    const row: ActivityRow = {
      streamId: "s1",
      lastReceivedAt: minsAgo(20),
      silenceEventAt: null,
    };
    const record = mock(async () => {});
    const recorder = { record } as unknown as ImportantEventRecorder;
    // A DROPPED marker: setSilenceMarker never persists, so the row stays
    // marker-less and every pass re-classifies as "emit_silence".
    const storage = {
      setSilenceMarker: mock(async () => {}),
    } as unknown as Storage;

    const db = fakeDb(row);
    await runSilenceDetection({ db, storage, recorder, logger: noopLogger, now });
    await runSilenceDetection({ db, storage, recorder, logger: noopLogger, now });

    // Without a persisted marker the silence event fires on BOTH passes -
    // proving it is the marker, not some other guard, that prevents re-emission.
    expect(record).toHaveBeenCalledTimes(2);
  });
});
