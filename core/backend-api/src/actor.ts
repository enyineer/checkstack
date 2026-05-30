import { SYSTEM_ACTOR, type Actor } from "@checkstack/common";
import type { AuthUser } from "./types";

/**
 * Resolve the canonical platform {@link Actor} for an event from the
 * authenticated caller. Background / unauthenticated emits (no `user`)
 * resolve to the system actor, so every emitted event carries an actor.
 *
 * - {@link RealUser}        -> `{ type: "user" }`
 * - {@link ApplicationUser} -> `{ type: "application" }`
 * - {@link ServiceUser}     -> `{ type: "service", id: pluginId }`
 * - `undefined`             -> {@link SYSTEM_ACTOR}
 */
export function resolveActor(user?: AuthUser): Actor {
  if (!user) return SYSTEM_ACTOR;
  switch (user.type) {
    case "user": {
      return { type: "user", id: user.id, name: user.name };
    }
    case "application": {
      return { type: "application", id: user.id, name: user.name };
    }
    case "service": {
      return { type: "service", id: user.pluginId, name: user.pluginId };
    }
  }
}
