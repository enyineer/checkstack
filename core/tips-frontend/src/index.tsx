import {
  createFrontendPlugin,
  NavbarRightSlot,
  UserMenuItemsSlot,
} from "@checkstack/frontend-api";
import { pluginMetadata } from "@checkstack/tips-common";
import { TipsSynchronizer } from "./components/TipsSynchronizer";
import { HelpMenuItems } from "./components/HelpMenuItems";

export { Tip } from "./components/Tip";
export type { TipProps } from "./components/Tip";
export { TipBanner } from "./components/TipBanner";
export type { TipBannerProps } from "./components/TipBanner";
export { useTipState } from "./hooks/useTipState";
export type {
  UseTipStateOptions,
  UseTipStateResult,
} from "./hooks/useTipState";
export { useResetAllTips } from "./hooks/useResetAllTips";
export type { UseResetAllTipsResult } from "./hooks/useResetAllTips";

export const tipsPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [],
  extensions: [
    {
      id: "tips.navbar.synchronizer",
      slot: NavbarRightSlot,
      component: TipsSynchronizer,
    },
    {
      // Negative priority pins Help above the zero-priority theme toggles,
      // About, and Logout, so its position never depends on plugin load order.
      id: "tips.user-menu.help",
      slot: UserMenuItemsSlot,
      metadata: { priority: -10 },
      component: HelpMenuItems,
    },
  ],
});
