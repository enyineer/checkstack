import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Monorepo root is 2 levels up from core/frontend
const monorepoRoot = path.resolve(__dirname, "../..");

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env from monorepo root
  const env = loadEnv(mode, monorepoRoot, "");
  const target = env.VITE_API_BASE_URL || "http://localhost:3000";
  return {
    // Tell Vite to look for .env files in monorepo root
    envDir: monorepoRoot,
    plugins: [react()],
    server: {
      proxy: {
        // Proxy API requests and WebSocket connections to backend
        // Use regex to ensure /api-docs doesn't match (it starts with /api but isn't an API call)
        "^/api/": {
          target,
          ws: true, // Enable WebSocket proxy
        },
        "/assets": target,
      },
    },
    build: {
      rollupOptions: {
        external: [
          "react",
          "react-dom",
          "react-dom/client",
          "react-router-dom",
          "@checkmate-monitor/frontend-api",
        ],
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
