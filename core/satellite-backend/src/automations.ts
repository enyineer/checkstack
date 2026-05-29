/**
 * Satellite triggers registered with the Automation Platform.
 *
 * The plan calls for `satellite.connected`, `satellite.disconnected`,
 * and `satellite.heartbeat_lost` — all three were added as new hooks
 * in `./hooks.ts` and emitted from the WS handler (connect/disconnect)
 * and heartbeat monitor (online → offline). No mutation actions for
 * satellite in this phase.
 */
import { z } from "zod";
import type { TriggerDefinition } from "@checkstack/automation-backend";

import { satelliteHooks } from "./hooks";

const satelliteEventPayloadSchema = z.object({
  satelliteId: z.string(),
  name: z.string(),
  region: z.string(),
  timestamp: z.string(),
});

export const satelliteConnectedTrigger: TriggerDefinition<
  z.infer<typeof satelliteEventPayloadSchema>
> = {
  id: "connected",
  displayName: "Satellite Connected",
  description: "Fires when a satellite WebSocket completes authentication",
  category: "Satellites",
  icon: "Satellite",
  payloadSchema: satelliteEventPayloadSchema,
  hook: satelliteHooks.connected,
  contextKey: (p) => p.satelliteId,
};

export const satelliteDisconnectedTrigger: TriggerDefinition<
  z.infer<typeof satelliteEventPayloadSchema>
> = {
  id: "disconnected",
  displayName: "Satellite Disconnected",
  description: "Fires when a satellite's WebSocket closes",
  category: "Satellites",
  icon: "Satellite",
  payloadSchema: satelliteEventPayloadSchema,
  hook: satelliteHooks.disconnected,
  contextKey: (p) => p.satelliteId,
};

export const satelliteHeartbeatLostTrigger: TriggerDefinition<
  z.infer<typeof satelliteEventPayloadSchema>
> = {
  id: "heartbeat_lost",
  displayName: "Satellite Heartbeat Lost",
  description:
    "Fires when a satellite transitions online → offline (no heartbeat within threshold)",
  category: "Satellites",
  icon: "Satellite",
  payloadSchema: satelliteEventPayloadSchema,
  hook: satelliteHooks.heartbeatLost,
  contextKey: (p) => p.satelliteId,
};

export const satelliteTriggers: TriggerDefinition<unknown>[] = [
  satelliteConnectedTrigger as TriggerDefinition<unknown>,
  satelliteDisconnectedTrigger as TriggerDefinition<unknown>,
  satelliteHeartbeatLostTrigger as TriggerDefinition<unknown>,
];
