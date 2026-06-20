/**
 * Pure round-robin shard selection for the E2E runner.
 *
 * Kept in its own side-effect-free module so it is unit-testable without
 * importing `run-all.ts` (which boots Playwright and touches Postgres at the
 * top level). See `run-all.ts` for how the shard config is read from the
 * environment.
 */

/**
 * Select this shard's slice of an ordered list, round-robin. `shardIndex` is
 * 1-based (GitHub Actions matrix convention): the item at 0-based position `n`
 * runs when `n % shardTotal === shardIndex - 1`. Round-robin (rather than a
 * contiguous slice) keeps per-shard counts balanced to within one item, even
 * when the list is not evenly divisible.
 */
export function selectShard<T>({
  items,
  shardIndex,
  shardTotal,
}: {
  items: readonly T[];
  shardIndex: number;
  shardTotal: number;
}): T[] {
  if (!Number.isInteger(shardTotal) || shardTotal < 1) {
    throw new Error(
      `CHECKSTACK_E2E_SHARD_TOTAL must be a positive integer, got "${shardTotal}"`,
    );
  }
  if (
    !Number.isInteger(shardIndex) ||
    shardIndex < 1 ||
    shardIndex > shardTotal
  ) {
    throw new Error(
      `CHECKSTACK_E2E_SHARD_INDEX must be an integer in [1, ${shardTotal}], got "${shardIndex}"`,
    );
  }
  return items.filter((_item, n) => n % shardTotal === shardIndex - 1);
}
