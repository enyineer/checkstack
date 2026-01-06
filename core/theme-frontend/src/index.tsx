import {
  createFrontendPlugin,
  NavbarSlot,
  UserMenuItemsBottomSlot,
} from "@checkmate-monitor/frontend-api";
import { pluginMetadata } from "@checkmate-monitor/theme-common";
import { ThemeToggleMenuItem } from "./components/ThemeToggleMenuItem";
import { ThemeSynchronizer } from "./components/ThemeSynchronizer";
import { NavbarThemeToggle } from "./components/NavbarThemeToggle";

export const themePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [],
  extensions: [
    // Theme toggle in user menu (for logged-in users)
    {
      id: "theme.user-menu.toggle",
      slot: UserMenuItemsBottomSlot,
      component: ThemeToggleMenuItem,
    },
    // Theme synchronizer - headless component that syncs theme from backend on load
    {
      id: "theme.navbar.synchronizer",
      slot: NavbarSlot,
      component: ThemeSynchronizer,
    },
    // Theme toggle button in navbar (for non-logged-in users)
    {
      id: "theme.navbar.toggle",
      slot: NavbarSlot,
      component: NavbarThemeToggle,
    },
  ],
});
