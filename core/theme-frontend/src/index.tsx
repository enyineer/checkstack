import {
  createFrontendPlugin,
  NavbarRightSlot,
  UserMenuItemsBottomSlot,
} from "@checkstack/frontend-api";
import { pluginMetadata } from "@checkstack/theme-common";
import { ThemeToggleMenuItem } from "./components/ThemeToggleMenuItem";
import { PerformanceToggleMenuItem } from "./components/PerformanceToggleMenuItem";
import { ThemeSynchronizer } from "./components/ThemeSynchronizer";
import { NavbarThemeToggle } from "./components/NavbarThemeToggle";

export const themePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [],
  extensions: [
    // Theme toggle in user menu (for logged-in users)
    {
      id: "theme.user-menu.theme.toggle",
      slot: UserMenuItemsBottomSlot,
      component: ThemeToggleMenuItem,
    },
    // Performance toggle in user menu
    {
      id: "theme.user-menu.performance.toggle",
      slot: UserMenuItemsBottomSlot,
      component: PerformanceToggleMenuItem,
    },
    // Theme synchronizer - headless component that syncs theme from backend on load
    {
      id: "theme.navbar.synchronizer",
      slot: NavbarRightSlot,
      component: ThemeSynchronizer,
    },
    // Theme toggle button in navbar (for non-logged-in users)
    {
      id: "theme.navbar.toggle",
      slot: NavbarRightSlot,
      component: NavbarThemeToggle,
    },
  ],
});
