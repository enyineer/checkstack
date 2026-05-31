/**
 * Satellite connection triggers registered with the Automation Platform.
 *
 * These three triggers are ENTITY-DRIVEN (reactive automation engine §10.6):
 * the `satellite-connection` entity's change deriver fires
 * `satellite.connected` / `.disconnected` / `.heartbeat_lost` via Stage-1
 * routing, so they no longer subscribe to a hook. A no-op `setup`
 * (`makeEntityDrivenTriggerSetup`) keeps them in the editor's trigger catalog
 * (and payload-introspectable) without re-introducing a hook — mirroring how
 * the incident / catalog / dependency / healthcheck domains kept their
 * registrations after migrating. The runtime `trigger.payload` matches these
 * schemas via the `satelliteChangeToPayload` mapper registered alongside the
 * deriver.
 */
import { z } from "zod";
import type { TriggerDefinition } from "@checkstack/automation-backend";
import { makeEntityDrivenTriggerSetup } from "@checkstack/automation-backend";

// ─── Payload schemas ───────────────────────────────────────────────────
//
// The reactive `satellite-connection` entity state is `{ status, name, region,
// lastSeenAt, lastEvent }`. The entity-driven `trigger.payload` (see
// `satelliteChangeToPayload`) carries `satelliteId` (the entity id) + `name` /
// `region` / `status` / `lastSeenAt`. `lastSeenAt` is nullable (`null` after a
// clean disconnect / before the satellite was ever seen).
const satelliteConnectedPayloadSchema = z.object({
  satelliteId: z.string(),
  name: z.string(),
  region: z.string(),
  status: z.enum(["online", "offline"]),
  lastSeenAt: z.string().nullable(),
});

const satelliteDisconnectedPayloadSchema = z.object({
  satelliteId: z.string(),
  name: z.string(),
  region: z.string(),
  status: z.enum(["online", "offline"]),
  lastSeenAt: z.string().nullable(),
});

const satelliteHeartbeatLostPayloadSchema = z.object({
  satelliteId: z.string(),
  name: z.string(),
  region: z.string(),
  status: z.enum(["online", "offline"]),
  lastSeenAt: z.string().nullable(),
});

// ─── Triggers ──────────────────────────────────────────────────────────

export const satelliteConnectedTrigger: TriggerDefinition<
  z.infer<typeof satelliteConnectedPayloadSchema>
> = {
  id: "connected",
  displayName: "Satellite Connected",
  description: "Fires when a satellite establishes a connection",
  category: "Satellites",
  icon: "SatelliteDish",
  payloadSchema: satelliteConnectedPayloadSchema,
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof satelliteConnectedPayloadSchema>
  >(),
  contextKey: (p) => p.satelliteId,
};

export const satelliteDisconnectedTrigger: TriggerDefinition<
  z.infer<typeof satelliteDisconnectedPayloadSchema>
> = {
  id: "disconnected",
  displayName: "Satellite Disconnected",
  description: "Fires when a satellite's connection is closed",
  category: "Satellites",
  icon: "SatelliteDish",
  payloadSchema: satelliteDisconnectedPayloadSchema,
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof satelliteDisconnectedPayloadSchema>
  >(),
  contextKey: (p) => p.satelliteId,
};

export const satelliteHeartbeatLostTrigger: TriggerDefinition<
  z.infer<typeof satelliteHeartbeatLostPayloadSchema>
> = {
  id: "heartbeat_lost",
  displayName: "Satellite Heartbeat Lost",
  description:
    "Fires when a connected satellite stops sending heartbeats and ages out to offline",
  category: "Satellites",
  icon: "SatelliteDish",
  payloadSchema: satelliteHeartbeatLostPayloadSchema,
  setup: makeEntityDrivenTriggerSetup<
    z.infer<typeof satelliteHeartbeatLostPayloadSchema>
  >(),
  contextKey: (p) => p.satelliteId,
};

/**
 * All satellite connection triggers as a heterogeneous list. Typed as
 * `TriggerDefinition<unknown>[]` so the array can be iterated in the plugin
 * entry without TypeScript collapsing the union to a single payload shape.
 */
export const satelliteTriggers: TriggerDefinition<unknown>[] = [
  satelliteConnectedTrigger as TriggerDefinition<unknown>,
  satelliteDisconnectedTrigger as TriggerDefinition<unknown>,
  satelliteHeartbeatLostTrigger as TriggerDefinition<unknown>,
];
