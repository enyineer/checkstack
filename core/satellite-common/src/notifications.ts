import {
  createCollapseKeyBuilder,
  createSubjectKindBuilder,
  createSubscriptionFactory,
  defineNotificationTarget,
} from "@checkstack/notification-common";
import { pluginMetadata } from "./plugin-metadata";

/** A satellite as a subscribable notification resource. */
export interface SatelliteResource {
  satelliteId: string;
  satelliteName: string;
}

/**
 * Collapse key for satellite connectivity notifications.
 *
 * Keyed per satellite so a flapping link replaces its own previous notice
 * rather than stacking one per transition.
 */
export const satelliteCollapseKey = createCollapseKeyBuilder(
  pluginMetadata,
  "connection",
);

/**
 * The "satellite" target type. Resources are the rows of the satellites table;
 * satellite-backend registers them on boot and keeps them current on
 * create/rename/delete.
 */
export const satelliteTarget = defineNotificationTarget<SatelliteResource>({
  pluginMetadata,
  localId: "satellite",
  resourceKind: "satellite",
  keyOf: ({ satelliteId }) => satelliteId,
  labelOf: ({ satelliteName }) => satelliteName,
});

/**
 * Names the satellite a notification is ABOUT, so a digest or a chat card can
 * group and label it without parsing the body.
 */
export const createSatelliteSubject = createSubjectKindBuilder(
  pluginMetadata,
  "satellite",
);

const { defineSubscription } = createSubscriptionFactory(pluginMetadata);

/**
 * Connectivity notifications for one satellite.
 *
 * A satellite going offline is the single most consequential thing that can
 * happen to it and was previously invisible: the checks it executes simply
 * stop producing runs, so an operator learns about it only by noticing that a
 * graph went flat. Subscribing here surfaces the transition directly.
 *
 * How long a satellite must be silent before this fires is per-satellite
 * (`offlineThresholdMs`), so a link known to be flaky can be given more grace
 * without making every other satellite equally slow to report.
 */
export const satelliteConnectionSubscription = defineSubscription({
  localId: "connection",
  target: satelliteTarget,
  display: {
    title: "Satellite connectivity",
    description:
      "This satellite losing its connection to the core, and recovering it.",
    iconName: "SatelliteDish",
  },
});
