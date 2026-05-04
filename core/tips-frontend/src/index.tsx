import {
  createFrontendPlugin,
  NavbarRightSlot,
} from "@checkstack/frontend-api";
import { pluginMetadata } from "@checkstack/tips-common";
import { TipsSynchronizer } from "./components/TipsSynchronizer";

export { Tip } from "./components/Tip";
export type { TipProps } from "./components/Tip";
export { TipBanner } from "./components/TipBanner";
export type { TipBannerProps } from "./components/TipBanner";
export { useTipState } from "./hooks/useTipState";
export type {
  UseTipStateOptions,
  UseTipStateResult,
} from "./hooks/useTipState";

export const tipsPlugin = createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [],
  extensions: [
    {
      id: "tips.navbar.synchronizer",
      slot: NavbarRightSlot,
      component: TipsSynchronizer,
    },
  ],
});
