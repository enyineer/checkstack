// Shared standalone TypeScript / JavaScript language-service setup.
//
// Extracted from `TypefoxEditor` so it can be imported by BOTH the editor and
// the headless `validateScripts` validator. Both need the same singletons
// configured (compiler options, ambient stdlib types, the TS worker), and the
// validator must work even when NO editor is mounted (every script action card
// collapsed) - so the setup cannot live inside the editor component module's
// render path.
//
// The TS/JS language-service `defaults` are singletons, so the configuration
// here runs ONCE at module load. The worker factory is registered lazily (and
// idempotently) via `ensureStandaloneWorkerFactory()` because the editor also
// registers it during its own init - the guard makes a double-call a no-op.

// Side-effect import: registers the standalone language grammars. Imported here
// too (not only in TypefoxEditor) so the validator gets a fully-registered TS
// language environment regardless of import order.
import "@codingame/monaco-vscode-standalone-languages";
// The named imports below ALSO trigger this package's side-effect registration
// of the standalone TypeScript language features (defaults + ts.worker).
import {
  typescriptDefaults,
  javascriptDefaults,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
} from "@codingame/monaco-vscode-standalone-typescript-language-features";
// Worker entry URLs, bundled and resolved by Vite via the `?worker&url` suffix.
// Imported as URL STRINGS (not Worker constructors) because
// monaco-languageclient's worker factory consumes `loader().url.toString()`.
import editorWorkerUrl from "@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js?worker&url";
import tsWorkerUrl from "@codingame/monaco-vscode-standalone-typescript-language-features/worker?worker&url";
import jsonWorkerUrl from "@codingame/monaco-vscode-standalone-json-language-features/worker?worker&url";
import {
  // `useWorkerFactory` is a plain library registration function, not a React
  // hook. We alias away the `use` prefix so the `react-hooks/rules-of-hooks`
  // lint rule (which keys purely off the identifier name) does not misfire.
  useWorkerFactory as registerWorkerFactory,
  Worker,
  type WorkerFactoryConfig,
  type WorkerLoader,
} from "monaco-languageclient/workerFactory";

// Re-exported so consumers keep a single import surface for the TS services.
export {
  typescriptDefaults,
  javascriptDefaults,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
} from "@codingame/monaco-vscode-standalone-typescript-language-features";

// The logger type originates from `@codingame/monaco-vscode-log-service-override`,
// which is not a direct dependency of this package. We derive it from the
// `WorkerFactoryConfig` we already import so we never reach for a transitive
// specifier (and never need an `any`).
type WorkerFactoryLogger = WorkerFactoryConfig["logger"];

const editorWorkerLoader: WorkerLoader = () =>
  new Worker(editorWorkerUrl, { type: "module" });

const tsWorkerLoader: WorkerLoader = () =>
  new Worker(tsWorkerUrl, { type: "module" });

const jsonWorkerLoader: WorkerLoader = () =>
  new Worker(jsonWorkerUrl, { type: "module" });

// The "monaco-vscode services ready" signal (`markVscodeServicesReady` /
// `areVscodeServicesReady` / `onVscodeServicesReady`) lives in the Monaco-free
// `vscodeServicesSignal` module so the barrel and the automation editor can
// observe readiness without importing this Monaco-heavy module. See that file
// for the full rationale.

let workerFactoryRegistered = false;

/**
 * Register the worker loaders for the standalone (classic) Monaco setup. We
 * only need the generic editor worker plus the TypeScript worker (which also
 * serves JavaScript) and the JSON worker. Mirrors the upstream
 * `defineClassicWorkers` helper.
 *
 * Idempotent: the first caller registers, subsequent calls no-op. Both the
 * editor (via its `monacoWorkerFactory` app-config hook) AND the headless
 * validator call this, so the guard prevents a double registration. The
 * editor's call may pass a `logger`; the first registration wins, so when the
 * validator registers first the editor simply reuses it (logging is optional).
 */
export const ensureStandaloneWorkerFactory = (
  logger?: WorkerFactoryLogger,
): void => {
  if (workerFactoryRegistered) {
    return;
  }
  workerFactoryRegistered = true;
  registerWorkerFactory({
    workerLoaders: {
      editorWorkerService: editorWorkerLoader,
      // Both must be defined or the worker factory errors (see upstream
      // helper-classic.ts).
      javascript: tsWorkerLoader,
      typescript: tsWorkerLoader,
      json: jsonWorkerLoader,
    },
    logger,
  });
};

// Base compiler options for the standalone TS + JS services. `types` (node +
// bun-types) is added only once the stdlib bundle has loaded (see
// ensureStandaloneStdlib), so the service doesn't transiently error on a
// missing `node` type while the ~3 MB bundle is still fetching.
//
// `baseUrl: "file:///"` anchors NodeJs bare-import resolution at the virtual
// root so an `import "lodash"` walks `file:///node_modules/...` - the same
// virtual layout the stdlib bundle AND the lazy-ATA extra-libs are registered
// under. `typeRoots` lists BOTH the `@types` root (so a package with no own
// types, e.g. lodash, falls back to `@types/lodash`) and the bare
// `node_modules` root (so the bundled `bun-types`, which is NOT under
// `@types`, still resolves as an ambient `types` entry).
export const BASE_COMPILER_OPTIONS = {
  target: ScriptTarget.ESNext,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.NodeJs,
  lib: ["esnext"],
  allowNonTsExtensions: false,
  noEmit: true,
  strict: true,
  esModuleInterop: true,
  baseUrl: "file:///",
  typeRoots: ["file:///node_modules/@types", "file:///node_modules"],
};

/**
 * Configure the standalone TS + JS language services ONCE at module load.
 * `typescriptDefaults` / `javascriptDefaults` are singletons, so doing this at
 * module scope (not per-mount) guarantees the first editor to mount cannot
 * start the service with stale defaults - the timing race the legacy monaco
 * editor hit.
 */
const configureTypeScriptDefaults = (): void => {
  for (const defaults of [typescriptDefaults, javascriptDefaults]) {
    defaults.setCompilerOptions({ ...BASE_COMPILER_OPTIONS });
    // 1108: a top-level `return` is valid because the runtime wraps scripts in
    // an async IIFE (same suppression as the legacy editor).
    defaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [1108] });
    // Push models to the worker eagerly so diagnostics/completions are ready on
    // the first keystroke.
    defaults.setEagerModelSync(true);
  }
};

configureTypeScriptDefaults();

/**
 * Lazy-load the bundled `@types/node` + `bun-types` declarations into the
 * standalone TS service so script editors have `console`, `fetch`, `process`,
 * `Bun`, etc. typed. The ~3 MB bundle is code-split into its own chunk and
 * fetched once. Runs at module load; this file is browser-only so the dynamic
 * import is safe here. Returns the in-flight promise so callers (the headless
 * validator) can await stdlib readiness before requesting diagnostics.
 */
let stdlibLoad: Promise<void> | undefined;
export const ensureStandaloneStdlib = (): Promise<void> => {
  if (stdlibLoad) {
    return stdlibLoad;
  }
  stdlibLoad = (async () => {
    const stdlibModule = await import("./generated/stdlib-types.json");
    const bundle = stdlibModule.default;
    for (const defaults of [typescriptDefaults, javascriptDefaults]) {
      for (const [path, content] of Object.entries(bundle)) {
        defaults.addExtraLib(content, `file:///${path}`);
      }
      // The @types/node + bun-types declarations now exist at their node_modules
      // virtual paths, so include them ambiently.
      defaults.setCompilerOptions({
        ...BASE_COMPILER_OPTIONS,
        types: ["node", "bun-types"],
      });
    }
  })();
  return stdlibLoad;
};

void ensureStandaloneStdlib();
