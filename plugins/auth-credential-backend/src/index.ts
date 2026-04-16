import {
  createBackendPlugin,
  type AuthStrategy,
} from "@checkstack/backend-api";
import { betterAuthExtensionPoint } from "@checkstack/auth-backend";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";

// Credential strategy has no configuration - it's built into better-auth
const credentialConfigV1 = z.object({});

const credentialStrategy: AuthStrategy<z.infer<typeof credentialConfigV1>> = {
  id: "credential",
  displayName: "Email & Password",
  description: "Traditional email and password authentication",
  icon: "KeyRound",
  configVersion: 1,
  configSchema: credentialConfigV1,
  requiresManualRegistration: true,
  clientFlow: { type: "credential" },
};

export default createBackendPlugin({
  metadata: pluginMetadata,
  register(env) {
    const extensionPoint = env.getExtensionPoint(betterAuthExtensionPoint);
    extensionPoint.addStrategy(credentialStrategy);
  },
});
