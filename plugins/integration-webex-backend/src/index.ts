import { createBackendPlugin } from "@checkstack/backend-api";
import { providerExtensionPoint } from "@checkstack/integration-backend";
import { pluginMetadata } from "./plugin-metadata";
import { webexProvider } from "./provider";

export default createBackendPlugin({
  metadata: pluginMetadata,

  register(env) {
    // Get the integration provider extension point
    const extensionPoint = env.getExtensionPoint(providerExtensionPoint);

    // Register the Webex provider with our plugin metadata
    extensionPoint.addProvider(webexProvider, pluginMetadata);
  },
});
