import {
  createBackendPlugin,
  type AuthStrategy,
  secret,
} from "@checkmate-monitor/backend-api";
import { betterAuthExtensionPoint } from "@checkmate-monitor/auth-backend";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";

/**
 * GitHub OAuth configuration schema.
 * Follows better-auth GitHub provider requirements.
 */
const _githubConfigV1 = z.object({
  enabled: z.boolean().default(false),
  clientId: secret({ description: "GitHub OAuth App Client ID" }).optional(),
  clientSecret: secret({
    description: "GitHub OAuth App Client Secret",
  }).optional(),
});

const githubConfigV2 = z.object({
  clientId: secret({ description: "GitHub OAuth App Client ID" }).optional(),
  clientSecret: secret({
    description: "GitHub OAuth App Client Secret",
  }).optional(),
});

const githubStrategy: AuthStrategy<z.infer<typeof githubConfigV2>> = {
  id: "github",
  displayName: "GitHub",
  description: "Sign in with GitHub",
  icon: "github", // Lucide icon name
  configVersion: 2,
  configSchema: githubConfigV2,
  requiresManualRegistration: false,
  adminInstructions: `
## GitHub OAuth App Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Set **Homepage URL** to your Checkmate instance URL
4. Set **Authorization callback URL** to \`https://yourdomain.com/api/auth/callback/github\`
5. Copy the **Client ID** and generate a **Client Secret**
`.trim(),
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
  metadata: pluginMetadata,
  register(env) {
    const extensionPoint = env.getExtensionPoint(betterAuthExtensionPoint);
    extensionPoint.addStrategy(githubStrategy);
  },
});
