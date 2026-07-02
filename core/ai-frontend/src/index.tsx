import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { aiRoutes, pluginMetadata, aiAccess } from "@checkstack/ai-common";
import { AboutSectionsSlot } from "@checkstack/about-common";
import { Sparkles, Brain, Lightbulb } from "lucide-react";

export default createFrontendPlugin({
  metadata: pluginMetadata,
  routes: [
    {
      route: aiRoutes.routes.chat,
      load: () =>
        import("./pages/ChatPage").then((m) => ({ default: m.ChatPage })),
      title: "AI assistant",
      accessRule: aiAccess.chatUse,
      nav: {
        group: "Workspace",
        icon: Sparkles,
      },
    },
    {
      route: aiRoutes.routes.memories,
      load: () =>
        import("./pages/MemoriesPage").then((m) => ({
          default: m.MemoriesPage,
        })),
      title: "Assistant memory",
      accessRule: aiAccess.memoryRead,
      nav: {
        group: "Workspace",
        icon: Brain,
      },
    },
    {
      route: aiRoutes.routes.skills,
      load: () =>
        import("./pages/SkillsPage").then((m) => ({
          default: m.SkillsPage,
        })),
      title: "AI skills",
      accessRule: aiAccess.skillRead,
      nav: {
        group: "Workspace",
        icon: Lightbulb,
      },
    },
  ],
  apis: [],
  extensions: [
    // Contribute a permission-gated "Memories" section to the platform About
    // page. Opens a Sheet listing every memory the user can see.
    createSlotExtension(AboutSectionsSlot, {
      id: "ai.about.memories",
      metadata: {},
      load: () =>
        import("./components/AboutMemoriesButton").then((m) => ({
          default: m.AboutMemoriesButton,
        })),
    }),
  ],
});
