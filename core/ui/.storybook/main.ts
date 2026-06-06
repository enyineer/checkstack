import type { StorybookConfig } from "@storybook/react-vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";
import { monacoViteConfig } from "../src/vite-monaco";

const storybookDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(storybookDir, "..");

// Shared Monaco editor Vite settings (ES-module workers + the `vscode` alias),
// from @checkstack/ui's monacoViteConfig helper — the SAME settings the app's
// vite.config.ts and @checkstack/dev-server use, so the three configs never
// drift. `CodeEditor` (via @typefox/monaco-editor-react + monaco-languageclient)
// pulls in the @codingame/monaco-vscode-* stack whose runtime does
// `require("vscode")`; the alias resolves it under bun's isolated store.
const monaco = monacoViteConfig({ resolveFrom: [uiRoot] });

const config: StorybookConfig = {
  stories: [
    "../stories/**/*.mdx",
    "../stories/**/*.stories.@(ts|tsx)",
  ],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-themes",
    "@storybook/addon-a11y",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  typescript: {
    reactDocgen: "react-docgen",
  },
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      worker: monaco.worker,
      resolve: { alias: { ...monaco.resolve.alias } },
    }),
};

export default config;
