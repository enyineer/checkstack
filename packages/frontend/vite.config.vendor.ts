import { defineConfig } from "vite";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "public/vendor",
    emptyOutDir: true,
    lib: {
      entry: {
        react: require.resolve("react"),
        "react-dom-client": require.resolve("react-dom/client"),
        "react-router-dom": require.resolve("react-router-dom"),
        "frontend-api": require.resolve("@checkmate/frontend-api"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "vendor-shared-[hash].js",
      },
    },
  },
});
