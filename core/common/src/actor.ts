import { z } from "zod";

/**
 * Who (or what) caused a platform event. Travels as event-envelope metadata
 * on every emitted hook and is surfaced to automations as `trigger.actor`, so
 * an automation can filter on the origin of the event it reacts to - e.g.
 * "only incidents auto-created by the system" or "systems created by a
 * specific application/API client".
 *
 * - `system`      - no authenticated caller (platform-internal / background /
 *                   automatic events such as healthcheck or SLO triggers).
 * - `user`        - a human user (session/token authenticated).
 * - `application` - an external application authenticated via API key.
 * - `service`     - a trusted backend-to-backend (plugin) call; `id` is the
 *                   originating plugin id.
 */
export const ACTOR_TYPES = ["system", "user", "application", "service"] as const;

export type ActorType = (typeof ACTOR_TYPES)[number];

export const ActorSchema = z.object({
  type: z.enum(ACTOR_TYPES),
  /**
   * Stable identifier for the actor: the user id, application id, originating
   * plugin id for services, or the literal `"system"`.
   */
  id: z.string(),
  /** Human-readable display name when known (absent for system/service). */
  name: z.string().optional(),
});

export type Actor = z.infer<typeof ActorSchema>;

/** Canonical actor for platform-internal / unauthenticated events. */
export const SYSTEM_ACTOR: Actor = {
  type: "system",
  id: "system",
  name: "System",
};
