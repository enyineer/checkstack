import { describe, it, expect, mock } from "bun:test";
import { withScopedTransaction } from "./scoped-transaction";

/**
 * `withScopedTransaction` is the reusable batching primitive: it delegates to
 * the scoped-db's `.transaction()`, which the proxy implements by injecting
 * `SET LOCAL search_path` ONCE and running the callback against a transaction
 * handle. These tests pin that contract with a fake db.
 */
describe("withScopedTransaction", () => {
  it("runs the callback inside db.transaction and returns its result", async () => {
    const tx = { marker: "tx-handle" };
    const transaction = mock((cb: (t: unknown) => unknown) => cb(tx));
    const db = { transaction };

    const received: unknown[] = [];
    const result = await withScopedTransaction(db as never, async (t) => {
      received.push(t);
      return 42;
    });

    expect(result).toBe(42);
    expect(transaction).toHaveBeenCalledTimes(1);
    // The callback ran against the transaction handle the db provided.
    expect(received).toEqual([tx]);
  });

  it("propagates rejections from the callback (transaction rolls back)", async () => {
    const tx = {};
    const transaction = mock((cb: (t: unknown) => unknown) => cb(tx));
    const db = { transaction };

    await expect(
      withScopedTransaction(db as never, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
