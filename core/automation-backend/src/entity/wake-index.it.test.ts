/**
 * Integration test placeholder (real Postgres) for the wake-index arm race.
 *
 * Part of the surgical integration lane (plan §14.4 #3). The target — the
 * `automation_wake_index` child table and its concurrent-insert / intersection
 * lookup — is built in a LATER phase (plan §8 / §16.5). This file is a SKIPPED
 * scaffold so the harness, file convention, and CI wiring exist now; it does
 * NOT import any not-yet-existing module.
 *
 * NOTE: `describe.skipIf(true)` makes this unconditionally skip even when
 * `CHECKSTACK_IT=1` is set. The implementing phase MUST flip this to
 * `describe.skipIf(!process.env.CHECKSTACK_IT)` (matching the other
 * `*.it.test.ts` files) once the wake-index exists.
 *
 * TODO(plan §8.2 / §14.4 #3): Implement against real Postgres once the
 * `automation_wake_index` table + insert/lookup queries land (§16.5).
 * Assertion to implement:
 *   - Concurrently insert the SAME `(wait_lock_id, ref)` pair from multiple
 *     callers under `ON CONFLICT DO NOTHING`. Exactly ONE row must exist
 *     afterwards (the arm race must not double-insert).
 *   - The key-intersection lookup
 *       SELECT wl.* FROM automation_wait_locks wl
 *       JOIN automation_wake_index wi ON wi.wait_lock_id = wl.id
 *       WHERE wi.ref = $1 AND wl.kind = 'until';
 *     must return the owning wait lock for the changed `kind:id` ref.
 */
import { describe, expect, it } from "bun:test";

describe.skipIf(true)("wake-index arm race (real Postgres)", () => {
  it("exactly one row survives concurrent same-ref inserts (TODO §16.5)", () => {
    // Placeholder — see the file-level TODO. Intentionally trivial so the
    // skipped suite still type-checks and runs zero real assertions.
    expect(true).toBe(true);
  });
});
