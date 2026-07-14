import { describe, it, expect } from "bun:test";
import {
  chunkTelemetryBatchItems,
  estimateTelemetryItemBytes,
  TELEMETRY_ITEM_OVERHEAD_BYTES,
} from "./batch-items";

const TOKEN = "cktr_s1_secret";

interface Item {
  streamToken: string;
  records: number[];
}

/** Wrap a record slice in a minimal item, doubling each record (proves toItem runs). */
const toItem = ({
  streamToken,
  records,
}: {
  streamToken: string;
  records: number[];
}): Item => ({ streamToken, records: records.map((r) => r * 2) });

describe("chunkTelemetryBatchItems", () => {
  it("returns no items for an empty record list", () => {
    expect(
      chunkTelemetryBatchItems({
        streamToken: TOKEN,
        records: [],
        maxPerItem: 3,
        toItem,
      }),
    ).toEqual([]);
  });

  it("splits records into items of at most maxPerItem, with a trailing remainder", () => {
    const records = [1, 2, 3, 4, 5, 6, 7];
    const items = chunkTelemetryBatchItems({
      streamToken: TOKEN,
      records,
      maxPerItem: 3,
      toItem,
    });
    expect(items).toHaveLength(3);
    expect(items[0]!.records).toEqual([2, 4, 6]);
    expect(items[1]!.records).toEqual([8, 10, 12]);
    expect(items[2]!.records).toEqual([14]);
    expect(items.every((i) => i.streamToken === TOKEN)).toBe(true);
  });

  it("yields no trailing empty item when the count is an exact multiple", () => {
    const items = chunkTelemetryBatchItems({
      streamToken: TOKEN,
      records: [1, 2, 3, 4],
      maxPerItem: 2,
      toItem,
    });
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.records.length)).toEqual([2, 2]);
  });

  it("keeps a single record that fits under the cap as one item", () => {
    const items = chunkTelemetryBatchItems({
      streamToken: TOKEN,
      records: [42],
      maxPerItem: 250,
      toItem,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.records).toEqual([84]);
  });

  it("emits one item per record when maxPerItem is 1", () => {
    const items = chunkTelemetryBatchItems({
      streamToken: TOKEN,
      records: [1, 2, 3],
      maxPerItem: 1,
      toItem,
    });
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.records)).toEqual([[2], [4], [6]]);
  });
});

describe("estimateTelemetryItemBytes", () => {
  it("is token length + overhead for an item with no records", () => {
    expect(
      estimateTelemetryItemBytes({
        streamToken: TOKEN,
        records: [],
        perRecordBytes: () => 100,
      }),
    ).toBe(TOKEN.length + TELEMETRY_ITEM_OVERHEAD_BYTES);
  });

  it("adds each record's own estimate on top of the token + overhead", () => {
    const bytes = estimateTelemetryItemBytes({
      streamToken: TOKEN,
      records: [10, 20, 30],
      perRecordBytes: (r) => r,
    });
    expect(bytes).toBe(TOKEN.length + TELEMETRY_ITEM_OVERHEAD_BYTES + 60);
  });

  it("grows with record count for a constant per-record budget (metric-style)", () => {
    const one = estimateTelemetryItemBytes({
      streamToken: TOKEN,
      records: [0],
      perRecordBytes: () => 48,
    });
    const many = estimateTelemetryItemBytes({
      streamToken: TOKEN,
      records: [0, 0, 0],
      perRecordBytes: () => 48,
    });
    expect(many - one).toBe(96);
  });
});
