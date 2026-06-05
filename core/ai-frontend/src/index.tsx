import { createFrontendPlugin } from "@checkstack/frontend-api";
import { aiRoutes, pluginMetadata, aiAccess } from "@checkstack/ai-common";
import { Sparkles } from "lucide-react";

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
  ],
  apis: [],
  extensions: [],
});
