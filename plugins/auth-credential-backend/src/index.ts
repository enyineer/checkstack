import {
  createBackendPlugin,
  type AuthStrategy,
} from "@checkmate-monitor/backend-api";
import { betterAuthExtensionPoint } from "@checkmate-monitor/auth-backend";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";

// Credential strategy has no configuration - it's built into better-auth
const credentialConfigV1 = z.object({});

const credentialStrategy: AuthStrategy<z.infer<typeof credentialConfigV1>> = {
  id: "credential",
  displayName: "Email & Password",
  description: "Traditional email and password authentication",
  icon: "key-round", // Lucide icon name
  configVersion: 1,
  configSchema: credentialConfigV1,
  requiresManualRegistration: true,
};

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    const extensionPoint = env.getExtensionPoint(betterAuthExtensionPoint);
    extensionPoint.addStrategy(credentialStrategy);
  },
});
