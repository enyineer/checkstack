import { accessPair } from "@checkstack/common";

import { pluginMetadata } from "./plugin-metadata";

export const anomalyAccess = {
  feed: accessPair(
    "anomaly_feed",
    {
      read: {
        description: "View anomaly feed and status badges",
        isDefault: true,
        isPublic: true,
      },
      manage: {
        description: "Manage anomaly configuration and noise floors",
      },
    },
    {
      idParam: "systemId",
      pluginId: pluginMetadata.pluginId,
    }
  ),
};

export const anomalyAccessRules = [
  anomalyAccess.feed.read,
  anomalyAccess.feed.manage,
];
