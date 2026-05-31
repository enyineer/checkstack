/**
 * Integration test placeholder (real Redis / BullMQ) for Stage-1 routing.
 *
 * Part of the surgical integration lane (plan §14.4 #4). The target — the
 * Stage-1 `ENTITY_CHANGED` work-queue (`workerGroup:
 * "automation-entity-route"`) — is built in a LATER phase (plan §13 / §16.5).
 * This file is a SKIPPED scaffold so the harness and CI wiring exist now; it
 * does NOT import any not-yet-existing module.
 *
 * NOTE: `describe.skipIf(true)` makes this unconditionally skip even when
 * `CHECKSTACK_IT=1` is set. The implementing phase MUST flip this to
 * `describe.skipIf(!process.env.CHECKSTACK_IT)` (matching the other
 * `*.it.test.ts` files) once Stage-1 routing exists.
 *
 * TODO(plan §13 / §14.4 #4): Implement against real Redis/BullMQ once the
 * Stage-1 work-queue lands (§16.5). Assertion to implement:
 *   - Subscribe TWO workers in the same consumer group
 *     (`workerGroup: "automation-entity-route"`) to the `ENTITY_CHANGED`
 *     hook on real Redis.
 *   - Emit a single `ENTITY_CHANGED` event.
 *   - Assert the routing handler runs EXACTLY ONCE across both workers
 *     (work-queue exactly-once claim — `event-bus.ts:113-131`).
 *   - Connection from `CHECKSTACK_IT_REDIS_URL`.
 */
import { describe, expect, it } from "bun:test";

describe.skipIf(true)("Stage-1 routing exactly-once (real Redis)", () => {
  it("one ENTITY_CHANGED emit runs the handler once (TODO §16.5)", () => {
    // Placeholder — see the file-level TODO. Intentionally trivial so the
    // skipped suite still type-checks and runs zero real assertions.
    expect(true).toBe(true);
  });
});
