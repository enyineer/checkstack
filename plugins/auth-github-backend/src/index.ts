import {
  createBackendPlugin,
  type AuthStrategy,
  secret,
} from "@checkmate/backend-api";
import { betterAuthExtensionPoint } from "@checkmate/auth-backend";
import { z } from "zod";

/**
 * GitHub OAuth configuration schema.
 * Follows better-auth GitHub provider requirements.
 */
const githubConfigV1 = z.object({
  enabled: z.boolean().default(false),
  clientId: secret().optional().describe("GitHub OAuth App Client ID"),
  clientSecret: secret().optional().describe("GitHub OAuth App Client Secret"),
});

const githubStrategy: AuthStrategy<z.infer<typeof githubConfigV1>> = {
  id: "github",
  displayName: "GitHub",
  description: "Sign in with GitHub",
  icon: "github", // Lucide icon name
  configVersion: 1,
  configSchema: githubConfigV1,
  requiresManualRegistration: false,
};

export default createBackendPlugin({
  pluginId: "auth-github-backend",
  register(env) {
    const extensionPoint = env.getExtensionPoint(betterAuthExtensionPoint);
    extensionPoint.addStrategy(githubStrategy);
  },
});
