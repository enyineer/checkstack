import {
  createFrontendPlugin,
  createSlotExtension,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import {
  secretsRoutes,
  secretsAccess,
  pluginMetadata,
} from "@checkstack/secrets-common";
import { lazy } from "react";
import { SecretsMenuItems } from "./components/SecretsMenuItems";

// Lazy-loaded so the page body is a per-route chunk, not in the initial load.
const SecretsSettingsPage = lazy(() =>
  import("./pages/SecretsSettingsPage").then((m) => ({
    default: m.SecretsSettingsPage,
  })),
);

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
      element: <SecretsSettingsPage />,
      title: "Secrets",
      accessRule: secretsAccess.secret.manage,
    },
  ],
  extensions: [
    createSlotExtension(UserMenuItemsSlot, {
      id: "secrets.user-menu.items",
      component: SecretsMenuItems,
      metadata: { group: "Configuration" },
    }),
  ],
});

export { useSecretNames } from "./useSecretNames";
