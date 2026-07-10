import {
  createFrontendPlugin,
  NavbarRightSlot,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import { pluginMetadata } from "@checkstack/theme-common";
import { ThemeToggleMenuItem } from "./components/ThemeToggleMenuItem";
import { PerformanceToggleMenuItem } from "./components/PerformanceToggleMenuItem";
import { DensityToggleMenuItem } from "./components/DensityToggleMenuItem";
import { ThemeSynchronizer } from "./components/ThemeSynchronizer";
import { NavbarThemeToggle } from "./components/NavbarThemeToggle";
import { NavbarPerformanceToggle } from "./components/NavbarPerformanceToggle";

export const themePlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [],
  extensions: [
    // Appearance toggles in the user menu (for logged-in users). The explicit
    // priorities keep the trio together and in a stable order, between the Help
    // section (-10) and About (40).
    {
      id: "theme.user-menu.theme.toggle",
      slot: UserMenuItemsSlot,
      metadata: { priority: 10 },
      component: ThemeToggleMenuItem,
    },
    // Performance toggle in user menu
    {
      id: "theme.user-menu.performance.toggle",
      slot: UserMenuItemsSlot,
      metadata: { priority: 20 },
      component: PerformanceToggleMenuItem,
    },
    // Density toggle in user menu (comfortable vs compact)
    {
      id: "theme.user-menu.density.toggle",
      slot: UserMenuItemsSlot,
      metadata: { priority: 30 },
      component: DensityToggleMenuItem,
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
    // Performance toggle button in navbar (for non-logged-in users)
    {
      id: "theme.navbar.performance.toggle",
      slot: NavbarRightSlot,
      component: NavbarPerformanceToggle,
    },
  ],
});
