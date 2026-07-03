import {
  createFrontendPlugin,
  createSlotExtension,
} from "@checkstack/frontend-api";
import { aiRoutes, pluginMetadata, aiAccess } from "@checkstack/ai-common";
import { SystemMetaSlot } from "@checkstack/catalog-common";
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
    // Contribute a permission-gated "Assistant Memories" button to the catalog
    // System Details "About" sidebar. Opens a Sheet listing this system's saved
    // memories; hidden entirely for users without ai.memory.read.
    createSlotExtension(SystemMetaSlot, {
      id: "ai.system-meta.memories",
      load: () =>
        import("./components/SystemMemoryButton").then((m) => ({
          default: m.SystemMemoryButton,
        })),
    }),
  ],
});
