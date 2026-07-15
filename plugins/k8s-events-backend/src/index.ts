import { createBackendPlugin } from "@checkstack/backend-api";
import { telemetrySourceExtensionPoint } from "@checkstack/telemetry-backend";
import { pluginMetadata } from "./plugin-metadata";
import { k8sEventsSourceType } from "./source-type";

/**
 * Kubernetes-events source-type plugin. Contributes the `k8s-events` telemetry
 * source type against the platform's source extension point. The plugin imports
 * the platform (telemetry-backend), never the reverse (dependency direction).
 */
export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    env
      .getExtensionPoint(telemetrySourceExtensionPoint)
      .registerSourceType(k8sEventsSourceType, pluginMetadata);
  },
});

/** @internal exported for the package's own tests. */
export { k8sEventsSourceType } from "./source-type";
