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
const _githubConfigV1 = z.object({
  enabled: z.boolean().default(false),
  clientId: secret().optional().describe("GitHub OAuth App Client ID"),
  clientSecret: secret().optional().describe("GitHub OAuth App Client Secret"),
});

const githubConfigV2 = z.object({
  clientId: secret().optional().describe("GitHub OAuth App Client ID"),
  clientSecret: secret().optional().describe("GitHub OAuth App Client Secret"),
});

const githubStrategy: AuthStrategy<z.infer<typeof githubConfigV2>> = {
  id: "github",
  displayName: "GitHub",
  description: "Sign in with GitHub",
  icon: "github", // Lucide icon name
  configVersion: 2,
  configSchema: githubConfigV2,
  requiresManualRegistration: false,
  migrations: [
    {
      fromVersion: 1,
      toVersion: 2,
      description: "Remove 'enabled' field from config (moved to meta config)",
      migrate: (oldConfig: z.infer<typeof _githubConfigV1>) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { enabled, ...rest } = oldConfig;
        return rest;
      },
    },
  ],
};

export default createBackendPlugin({
  pluginId: "auth-github-backend",
  register(env) {
    const extensionPoint = env.getExtensionPoint(betterAuthExtensionPoint);
    extensionPoint.addStrategy(githubStrategy);
  },
});
