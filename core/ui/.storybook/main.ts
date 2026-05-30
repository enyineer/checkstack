import type { StorybookConfig } from "@storybook/react-vite";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";

const storybookDir = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(storybookDir, "..");
const localRequire = createRequire(import.meta.url);

// Resolve the `vscode` npm-alias (= @codingame/monaco-vscode-extension-api) to
// an absolute path so Vite/Rolldown can alias it. This mirrors the same fix in
// core/frontend/vite.config.ts.
//
// `CodeEditor` (via @typefox/monaco-editor-react + monaco-languageclient) pulls
// in the @codingame/monaco-vscode-* stack, whose runtime package does
// `require("vscode")`. Under bun's isolated node_modules the `"vscode":
// "npm:@codingame/monaco-vscode-extension-api"` alias only exists inside the
// typefox / monaco-languageclient scopes, so the Storybook build can't resolve
// a bare `vscode` import and fails with "Rolldown failed to resolve import
// 'vscode'". We resolve the alias *through* @typefox so the path follows bun's
// store layout on any machine/CI rather than being hardcoded.
const typefoxDir = path.dirname(
  localRequire.resolve("@typefox/monaco-editor-react", { paths: [uiRoot] }),
);
const vscodeApiDir = path.dirname(
  localRequire.resolve("vscode", { paths: [typefoxDir] }),
);

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
      // The @typefox/monaco-editor-react + @codingame/monaco-vscode-* stack
      // loads its language services in ES module workers.
      worker: {
        format: "es",
      },
      resolve: {
        alias: {
          // Alias the `vscode` npm-alias to its real package dir so @codingame's
          // CJS `require("vscode")` resolves under bun's isolated store instead
          // of failing the build.
          vscode: vscodeApiDir,
        },
      },
    }),
};

export default config;
