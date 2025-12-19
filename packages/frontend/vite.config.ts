import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/assets": "http://localhost:3000",
    },
  },
  build: {
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react-dom/client",
        "react-router-dom",
        "@checkmate/frontend-api",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
