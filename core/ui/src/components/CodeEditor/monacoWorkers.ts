/// <reference types="vite/client" />
/**
 * Eager, module-load-time Monaco bootstrap. Three things happen here,
 * in this exact order, before any `<CodeEditor>` instance can mount:
 *
 *   1. Bundle the per-language web workers via Vite's `?worker` import
 *      suffix and install them via `MonacoEnvironment.getWorker`.
 *      Without locally-bundled workers, the loader's default CDN path
 *      sometimes fails silently (CORS on the worker scripts) and the
 *      TS service falls back to no-language-service mode.
 *
 *   2. Configure the TypeScript language service — compiler options,
 *      diagnostics options, eager-model-sync. The TS service in
 *      monaco-editor is a singleton that initialises lazily the FIRST
 *      time it sees a TS/JS model. Doing this config inside a
 *      per-mount `onMount` (the previous shape) meant a shell editor
 *      mounted first would start the service with defaults, and the
 *      later TS editor's config arrived too late.
 *
 *   3. Tell `@monaco-editor/react`'s loader to use our locally-bundled
 *      Monaco instance via `loader.config({ monaco })`. Without this
 *      the loader pulls Monaco from a CDN at runtime — which defeats
 *      the worker setup above.
 *
 * This file is imported as a SIDE EFFECT from MonacoEditor.tsx, so the
 * setup runs on the first import of CodeEditor regardless of which
 * language ends up being mounted first.
 */
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { loader } from "@monaco-editor/react";

// ─── 1. Workers ──────────────────────────────────────────────────────────

interface MonacoEnvironmentLike {
  getWorker(workerId: string, label: string): Worker;
}

(
  globalThis as unknown as { MonacoEnvironment: MonacoEnvironmentLike }
).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case "json": {
        return new jsonWorker();
      }
      case "css":
      case "scss":
      case "less": {
        return new cssWorker();
      }
      case "html":
      case "handlebars":
      case "razor": {
        return new htmlWorker();
      }
      case "typescript":
      case "javascript": {
        return new tsWorker();
      }
      default: {
        return new editorWorker();
      }
    }
  },
};

// ─── 2. TypeScript language service ──────────────────────────────────────
//
// In monaco-editor 0.55 the canonical access path is `monaco.typescript`
// (the older `monaco.languages.typescript` is marked
// `{ deprecated: true }` in the type defs and emits a tombstone object).
// Both still resolve to the same singleton at runtime; we use the new
// path for type-safety.

const tsDefaults = monaco.typescript.typescriptDefaults;
const jsDefaults = monaco.typescript.javascriptDefaults;

for (const defaults of [tsDefaults, jsDefaults]) {
  defaults.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
    lib: ["esnext"],
    // Pulls the bundled @types/node + bun-types declarations into the
    // ambient scope, so `process`, `Buffer`, the `Bun` global, etc. are
    // typed without the user needing any `/// <reference>`.
    types: ["node", "bun-types"],
    allowNonTsExtensions: false,
    noEmit: true,
    strict: true,
    esModuleInterop: true,
  });

  // Suppress diagnostics that don't apply to our script context:
  //   - 1108: "A 'return' statement can only be used within a function body"
  //           The runtime wraps legacy scripts in an async IIFE, so a
  //           top-level `return X;` is valid in the user's source.
  defaults.setDiagnosticsOptions({
    diagnosticCodesToIgnore: [1108],
  });

  // Eagerly push models to the TS worker the moment they're created so
  // diagnostics + completions are available on the first keystroke.
  defaults.setEagerModelSync(true);
}

// ─── 3. Loader ───────────────────────────────────────────────────────────
//
// Must be the LAST step: once a `<Editor>` mounts, `loader.init()` is
// called and config is locked. Pointing at our local `monaco` import
// bypasses the loader's default AMD/CDN path entirely.

loader.config({ monaco });
