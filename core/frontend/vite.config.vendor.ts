import { defineConfig } from "vite";
import path from "node:path";

/**
 * Vite config for building vendor bundles as ESM.
 * These bundles are served via Import Maps so runtime plugins
 * can use standard `import React from "react"` syntax.
 *
 * We point directly to node_modules - no custom entry files needed.
 */
export default defineConfig({
  // Don't copy public/ contents — the main build handles that
  publicDir: false,
  build: {
    outDir: "dist/vendor",
    emptyOutDir: true,
    lib: {
      formats: ["es"],
      // Point directly to node_modules packages
      entry: {
        react: path.resolve(__dirname, "node_modules/react/index.js"),
        "react-dom": path.resolve(__dirname, "node_modules/react-dom/index.js"),
        "react-dom-client": path.resolve(
          __dirname,
          "node_modules/react-dom/client.js"
        ),
        "react-router-dom": path.resolve(
          __dirname,
          "node_modules/react-router-dom/dist/index.js"
        ),
      },
    },
    rollupOptions: {
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
      },
    },
    minify: false,
    sourcemap: true,
  },
});
