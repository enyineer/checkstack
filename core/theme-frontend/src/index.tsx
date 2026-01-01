import {
  createFrontendPlugin,
  UserMenuItemsBottomSlot,
} from "@checkmate/frontend-api";
import { ThemeToggleMenuItem } from "./components/ThemeToggleMenuItem";

export const themePlugin = createFrontendPlugin({
  name: "theme-frontend",
  routes: [],
  extensions: [
    {
      id: "theme.user-menu.toggle",
      slot: UserMenuItemsBottomSlot,
      component: ThemeToggleMenuItem,
    },
  ],
});
