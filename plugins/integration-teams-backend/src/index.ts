import { createBackendPlugin } from "@checkstack/backend-api";
import { providerExtensionPoint } from "@checkstack/integration-backend";
import { pluginMetadata } from "./plugin-metadata";
import { teamsProvider } from "./provider";

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Get the integration provider extension point
    const extensionPoint = env.getExtensionPoint(providerExtensionPoint);

    // Register the Teams provider with our plugin metadata
    extensionPoint.addProvider(teamsProvider, pluginMetadata);
  },
});
