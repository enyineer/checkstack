import { createFrontendPlugin } from "@checkstack/frontend-api";
import {
  secretsRoutes,
  secretsAccess,
  pluginMetadata,
} from "@checkstack/secrets-common";
import { KeyRound } from "lucide-react";

/**
 * Frontend plugin for the Secrets platform.
 *
 * Route: `/secrets/` -> the admin settings page (create / rotate / delete
 * secrets, view the active backend). Gated on `secrets.manage`.
 *
 * Secret VALUES are write-only: the create/rotate forms accept a value but
 * no endpoint ever returns one. The list shows only name + metadata +
 * `hasValue`.
 */
export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: secretsRoutes.routes.home,
      load: () =>
        import("./pages/SecretsSettingsPage").then((m) => ({
          default: m.SecretsSettingsPage,
        })),
      title: "Secrets",
      accessRule: secretsAccess.secret.manage,
      nav: {
        group: "Configuration",
        icon: KeyRound,
      },
    },
  ],
});

export { useSecretNames } from "./useSecretNames";
