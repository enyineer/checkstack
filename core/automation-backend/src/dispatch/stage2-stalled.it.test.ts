/**
 * Integration test placeholder (real Redis / BullMQ) for Stage-2 stalled
 * redelivery.
 *
 * Part of the surgical integration lane (plan §14.4 #5). The target — BullMQ
 * stalled-job redelivery on the `automation-dispatch` queue — is built in a
 * LATER phase (plan §15.4 / §16.6). This file is a SKIPPED scaffold so the
 * harness and CI wiring exist now; it does NOT import any not-yet-existing
 * module.
 *
 * NOTE: `describe.skipIf(true)` makes this unconditionally skip even when
 * `CHECKSTACK_IT=1` is set. The implementing phase MUST flip this to
 * `describe.skipIf(!process.env.CHECKSTACK_IT)` (matching the other
 * `*.it.test.ts` files) once Stage-2 dispatch + the explicit BullMQ
 * lock/stalled options exist.
 *
 * TODO(plan §15.4 / §14.4 #5): Implement against real Redis/BullMQ once the
 * Stage-2 dispatch queue and explicit `lockDuration` / `stalledInterval` /
 * `maxStalledCount` options land (§16.6). Assertion to implement:
 *   - Start a Stage-2 worker that claims a dispatch job and then DIES while
 *     holding it (simulate a crash — stop renewing the lock).
 *   - After the lock expires, another worker must redeliver the stalled job
 *     and complete it EXACTLY ONCE (no duplicate side effect).
 *   - This is load-bearing for §15.5 (crash recovery via stalled redelivery).
 *   - Connection from `CHECKSTACK_IT_REDIS_URL`.
 */
import { describe, expect, it } from "bun:test";

describe.skipIf(true)("Stage-2 stalled redelivery (real Redis)", () => {
  it("a dead worker's job is redelivered and completed once (TODO §16.6)", () => {
    // Placeholder — see the file-level TODO. Intentionally trivial so the
    // skipped suite still type-checks and runs zero real assertions.
    expect(true).toBe(true);
  });
});
