/**
 * Shared chunking + byte-budget primitives for the satellite telemetry FORWARD
 * path. Every signal's agent receiver (logs, metrics, traces) splits parsed
 * records into per-token wire batch items of a signal-specific cap, and gives the
 * agent's bounded telemetry buffer a proportional byte estimate per item. The two
 * mechanics - the chunk loop and the `token + Σ per-record` budget - were copied
 * per signal; they live here once. The per-signal specifics stay at the call site:
 * the item shape (`{ streamToken, lines|datapoints|spans }`), the record->wire
 * serializer, the item cap, and each record's own byte formula.
 *
 * Pure module: no IO, no node builtins.
 */

/**
 * Fixed per-item byte overhead added on top of the token length and the per-record
 * estimates. Covers the item's structural JSON envelope; a small constant is enough
 * because the buffer only needs a PROPORTIONAL budget, not an exact size.
 */
export const TELEMETRY_ITEM_OVERHEAD_BYTES = 16;

/**
 * Chunk domain `records` for one stream token into wire batch items of at most
 * `maxPerItem`. `toItem` maps each record slice to the signal's concrete item
 * shape (it also serializes each record to its wire form). Chunk boundaries are
 * exactly `[i, i + maxPerItem)`, so a lone record still yields one item and a
 * record count that is an exact multiple yields no trailing empty item.
 */
export function chunkTelemetryBatchItems<TRecord, TItem>({
  streamToken,
  records,
  maxPerItem,
  toItem,
}: {
  streamToken: string;
  records: readonly TRecord[];
  maxPerItem: number;
  toItem: (input: { streamToken: string; records: TRecord[] }) => TItem;
}): TItem[] {
  const items: TItem[] = [];
  for (let i = 0; i < records.length; i += maxPerItem) {
    items.push(
      toItem({ streamToken, records: records.slice(i, i + maxPerItem) }),
    );
  }
  return items;
}

/**
 * Estimate the serialized bytes of ONE forwarded telemetry item: the token length
 * plus {@link TELEMETRY_ITEM_OVERHEAD_BYTES}, plus each wire record's own estimate.
 * A proportional budget for the agent's bounded buffer - deliberately NOT an exact
 * `JSON.stringify` of the whole item, which would be O(payload) on every push.
 */
export function estimateTelemetryItemBytes<TWireRecord>({
  streamToken,
  records,
  perRecordBytes,
}: {
  streamToken: string;
  records: readonly TWireRecord[];
  perRecordBytes: (record: TWireRecord) => number;
}): number {
  let bytes = streamToken.length + TELEMETRY_ITEM_OVERHEAD_BYTES;
  for (const record of records) bytes += perRecordBytes(record);
  return bytes;
}
