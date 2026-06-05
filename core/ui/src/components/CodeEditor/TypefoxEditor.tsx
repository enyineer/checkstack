/// <reference types="vite/client" />
// Stage 1 foundation for the monaco-editor -> @typefox/monaco-editor-react
// migration. This is an ISOLATED test vehicle: it renders a single plain
// TypeScript editor with completions + diagnostics powered by the STANDALONE
// (classic) TypeScript language features. It is intentionally NOT wired into
// the existing `CodeEditor` / `MonacoEditor.tsx` and must NOT be re-exported
// from the package barrel (`src/index.ts`) because the underlying
// `@codingame/monaco-vscode-*` stack is browser-only and would break any
// SSR/test path that imports the barrel.
//
// API + config shape verified against the INSTALLED package types
// (@typefox/monaco-editor-react@7.7.0, monaco-languageclient@10.7.0, all
// @codingame/monaco-vscode-*@25.1.2) and the canonical standalone/classic
// worker registration in the upstream repo:
//   https://github.com/TypeFox/monaco-languageclient/blob/main/packages/client/test/support/helper-classic.ts
//   https://github.com/TypeFox/monaco-languageclient/blob/main/packages/client/test/worker/workerLoaders.test.ts

// Side-effect import registers the classic Monaco language contributions
// (Monarch grammars for ~80 languages) without pulling in the extension host
// (no SharedArrayBuffer / COOP / COEP needed).
import "@codingame/monaco-vscode-standalone-languages";
// TS/JS language-service setup (compiler options, ambient stdlib types, worker
// factory) lives in the shared `monacoTsService` module so the headless
// `validateScripts` validator can reuse the exact same configured singletons.
import {
  typescriptDefaults,
  javascriptDefaults,
  ensureStandaloneWorkerFactory,
} from "./monacoTsService";
import {
  areVscodeServicesReady,
  claimColdInit,
  markVscodeServicesReady,
  onVscodeServicesReady,
  releaseColdInit,
} from "./vscodeServicesSignal";
// Named import also triggers the side-effect registration of the REAL VS Code
// JSON language service (proper highlighting + completion + folding), replacing
// the hand-rolled `json-template` Monarch grammar. We turn its built-in
// (raw-text) validation OFF and validate the template-substituted form instead
// (see validateJsonTemplate), so templates work in any position - including
// unquoted ones like a numeric `"timeout": {{x}}`.
import { jsonDefaults } from "@codingame/monaco-vscode-standalone-json-language-features";
// Default export is `getServiceOverride()`, returning a service-id -> descriptor
// map. We register ONLY its `ILanguageStatusService` entry (see
// `languageStatusServiceOverride` below).
import getLanguagesServiceOverride from "@codingame/monaco-vscode-languages-service-override";


import {
  type CSSProperties,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
// Types come from the package directly (type-only, so it pulls no runtime code
// and the lint rule allows it). RUNTIME monaco access goes through the guarded
// accessor (`monacoRuntime`, see monacoGuard.ts): in dev it throws if a
// `monaco.editor.*` / `monaco.languages.*` function runs before the services
// are initialized, preventing the "Services are already initialized" regression
// class. `no-restricted-imports` forbids importing the raw editor-api value.
import type * as monaco from "@codingame/monaco-vscode-editor-api";
import { monaco as monacoRuntime } from "./monacoGuard";
import { useTheme } from "../ThemeProvider";
import { MONACO_THEME_MAP, VARIABLE_TOKEN_COLOR } from "./editorTheme";
import { MonacoEditorReactComp } from "@typefox/monaco-editor-react";
import { extractBracketKeyGroups } from "./bracketKeyGroups";
import { validateJsonTemplate } from "./validateJsonTemplate";
import { validateYamlTemplate } from "./validateYamlTemplate";
import { validateXmlTemplate } from "./validateXmlTemplate";
import type { TemplateDiagnostic } from "./templateValidation";
import { detectAutoClosedBraces, detectOpenTemplate } from "./templateUtils";
import {
  buildShellEnvVarInsertText,
  matchShellEnvVarTrigger,
} from "./shellEnvVarMatcher";
import type {
  AcquireTypes,
  CodeEditorLanguage,
  EditorMarker,
  ShellEnvVar,
  TemplateProperty,
} from "./types";
import {
  importSpecifierCompletionContext,
  mergeImportCompletionEntries,
  parseBareImportSpecifiers,
  planAcquisitions,
} from "./importSpecifiers";
// Authoritative, build-time-derived list of importable runtime built-in
// specifiers (`node:fs`, bare `fs`, `bun`, `bun:test`, ...). Generated from the
// SAME bundled `@types/node` + `bun-types` declarations the editor injects (see
// scripts/generate-stdlib-types.ts -> extractBuiltinModuleSpecifiers), so the
// import-name completions never drift from the runtime stdlib. Imported as a
// plain JSON module (tiny: ~115 names); the bulky type bodies stay in the
// separately code-split stdlib-types.json.
import builtinModulesJson from "./generated/builtin-modules.json";
import {
  type EditorAppConfig,
  type TextContents,
} from "monaco-languageclient/editorApp";
import { type MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";
// ─── Lazy Automatic Type Acquisition (ATA) registry ─────────────────────────
//
// The TS/JS language services are singletons, so acquired package types are
// registered ONCE and shared across every editor instance (a package imported
// in one script editor is then typed in all of them — harmless, since the
// declarations are the same install). State is module-scoped:
//
//  - `acquiredFilePaths`: virtual paths already passed to addExtraLib (dedupe
//    so two editors importing the same package don't double-register a file).
//  - `acquiredSpecifiers`: package names already acquired (skip the fetch).
//  - `acquireResetKey`: the install identity (lockfile hash) the current
//    acquired-set belongs to; when it changes, the set is reset so types
//    refresh against the new install.
const acquiredFilePaths = new Set<string>();
const acquiredSpecifiers = new Set<string>();
let currentAcquireResetKey: string | undefined;

/**
 * Reset the acquired-set when the install identity changes. The already-
 * registered extra-libs are left in place (disposing them is unnecessary —
 * the new install re-registers the same virtual paths, and addExtraLib
 * overwrites by path), but the specifier set clears so each package is
 * re-fetched against the new hash.
 */
const syncAcquireResetKey = (resetKey: string | undefined): void => {
  if (resetKey === currentAcquireResetKey) return;
  currentAcquireResetKey = resetKey;
  acquiredSpecifiers.clear();
  acquiredFilePaths.clear();
};

/**
 * Register one acquired package's declaration files with both the TS and JS
 * services, deduped by virtual path. Paths are `node_modules/...`-relative;
 * we mount each at `file:///<path>` so NodeJs + `@types` resolution finds it.
 */
const registerAcquiredFiles = (
  files: ReadonlyArray<{ path: string; content: string }>,
): void => {
  for (const file of files) {
    const uri = `file:///${file.path}`;
    if (acquiredFilePaths.has(uri)) continue;
    acquiredFilePaths.add(uri);
    for (const defaults of [typescriptDefaults, javascriptDefaults]) {
      defaults.addExtraLib(file.content, uri);
    }
  }
};

// ─── @checkstack/sdk editor-type injection ──────────────────────────────────
//
// The running release's SDK editor bundle (ambient `.d.ts` for the script
// helpers + typed client) is mounted ONCE into the shared TS/JS services,
// keyed by release version. A deployment upgrade changes the key, so the libs
// reset and the editor never serves stale SDK types (plan §6.2).
const sdkMountedPaths = new Set<string>();
let currentSdkResetKey: string | undefined;

/**
 * Mount the SDK bundle files, resetting on a release-version change. addExtraLib
 * overwrites by path, so a version bump re-mounts the same virtual paths with
 * fresh content; the mounted-path set just dedupes within a version so two
 * editors don't double-register.
 */
const mountSdkTypes = ({
  files,
  resetKey,
}: {
  files: ReadonlyArray<{ path: string; content: string }>;
  resetKey: string | undefined;
}): void => {
  if (resetKey !== currentSdkResetKey) {
    currentSdkResetKey = resetKey;
    sdkMountedPaths.clear();
  }
  for (const file of files) {
    const uri = `file:///${file.path}`;
    // On a fresh version we re-mount (overwrite) even if the path was seen
    // under a prior key; within a version, skip an already-mounted path.
    if (sdkMountedPaths.has(uri)) continue;
    sdkMountedPaths.add(uri);
    for (const defaults of [typescriptDefaults, javascriptDefaults]) {
      defaults.addExtraLib(file.content, uri);
    }
  }
};

/**
 * Acquire types for every NEW bare specifier in `source`, against the given
 * resolver. Pure planning (`parseBareImportSpecifiers` / `planAcquisitions`)
 * is unit-tested; this thin async glue is intentionally untested (no DOM /
 * network in unit tests). A specifier is marked acquired even when it returns
 * no files, so a typeless package isn't re-fetched on every keystroke.
 */
const runTypeAcquisition = async ({
  source,
  acquireTypes,
  resetKey,
}: {
  source: string;
  acquireTypes: AcquireTypes;
  resetKey: string | undefined;
}): Promise<void> => {
  syncAcquireResetKey(resetKey);
  const specifiers = parseBareImportSpecifiers(source);
  const toAcquire = planAcquisitions({
    specifiers,
    acquired: acquiredSpecifiers,
  });
  for (const specifier of toAcquire) {
    // Mark first so concurrent/keystroke re-runs don't double-fetch.
    acquiredSpecifiers.add(specifier);
    try {
      const files = await acquireTypes(specifier);
      registerAcquiredFiles(files);
    } catch {
      // A failed fetch un-marks so a later edit can retry.
      acquiredSpecifiers.delete(specifier);
    }
  }
};

// Turn OFF the JSON service's built-in validation. The editor content is a
// template that renders to JSON, so we validate the template-substituted form
// ourselves (see the json validation effect + validateJsonTemplate) to tolerate
// `{{ }}` in any position. Highlighting + completion from the service stay on.
jsonDefaults.setDiagnosticsOptions({ validate: false });

// Monaco language id per editor language. Matches the ids registered by
// @codingame/monaco-vscode-standalone-languages (verified: shell is "shell").
// JSON editors with templates use the custom `json-template` language (below).
const MONACO_LANGUAGE_ID: Record<CodeEditorLanguage, string> = {
  typescript: "typescript",
  javascript: "javascript",
  json: "json",
  yaml: "yaml",
  xml: "xml",
  markdown: "markdown",
  shell: "shell",
};

// File extension for the model uri, so the language service / grammar keys off
// a sensible filename.
const LANGUAGE_FILE_EXT: Record<CodeEditorLanguage, string> = {
  typescript: "ts",
  javascript: "js",
  json: "json",
  yaml: "yaml",
  xml: "xml",
  markdown: "md",
  shell: "sh",
};

const isTsLikeLanguage = (language: CodeEditorLanguage): boolean =>
  language === "typescript" || language === "javascript";

// Per-language template-aware validators (markdown has none - no structure to
// validate). Each validates the template-substituted form so `{{ }}` is
// tolerated anywhere; see templateValidation.ts.
const TEMPLATE_VALIDATORS: Partial<
  Record<CodeEditorLanguage, (text: string) => TemplateDiagnostic[]>
> = {
  json: validateJsonTemplate,
  yaml: validateYamlTemplate,
  xml: validateXmlTemplate,
};

// Variable-like tokens (`{{ template }}` expressions, shell `$env` refs) are
// highlighted via inline decorations rather than per-language grammars: this
// works for any language (yaml / xml / markdown have no template grammar; shell
// doesn't color `$VAR` inside strings) and keeps the color consistent.
// The style element is injected once and updated whenever the resolved theme
// changes so the decoration tracks the editor theme.
const VARIABLE_TOKEN_CLASS = "checkstack-editor-variable";
const VARIABLE_TOKEN_STYLE_ID = "checkstack-editor-variable-style";

const ensureVariableTokenStyle = ({
  resolvedTheme,
}: {
  resolvedTheme: "light" | "dark";
}): void => {
  const color = VARIABLE_TOKEN_COLOR[resolvedTheme];
  const existing = document.querySelector<HTMLStyleElement>(
    `#${VARIABLE_TOKEN_STYLE_ID}`,
  );
  if (existing !== null) {
    // Update in place so a theme toggle refreshes the color.
    existing.textContent = `.${VARIABLE_TOKEN_CLASS}{color:${color} !important;}`;
    return;
  }
  const style = document.createElement("style");
  style.id = VARIABLE_TOKEN_STYLE_ID;
  // `!important` so the decoration color always wins over the underlying token
  // color (.mtkN), making `{{ }}` look identical inside and outside strings.
  style.textContent = `.${VARIABLE_TOKEN_CLASS}{color:${color} !important;}`;
  document.head.append(style);
};

// Apply (and keep in sync) inline decorations for every match of `pattern` in
// the model. Returns a disposable that removes the decorations + listener.
// `pattern` must be a global (/g) regex; its lastIndex is reset per pass.
const installRegexDecorations = ({
  model,
  pattern,
  className,
}: {
  model: monaco.editor.ITextModel;
  pattern: RegExp;
  className: string;
}): monaco.IDisposable => {
  const compute = (): monaco.editor.IModelDeltaDecoration[] => {
    const text = model.getValue();
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      const start = model.getPositionAt(match.index);
      const end = model.getPositionAt(match.index + match[0].length);
      decorations.push({
        range: new monacoRuntime.Range(
          start.lineNumber,
          start.column,
          end.lineNumber,
          end.column,
        ),
        options: { inlineClassName: className },
      });
      // Guard against a zero-length match looping forever.
      if (pattern.lastIndex === match.index) {
        pattern.lastIndex += 1;
      }
      match = pattern.exec(text);
    }
    return decorations;
  };
  let decorationIds = model.deltaDecorations([], compute());
  const subscription = model.onDidChangeContent(() => {
    decorationIds = model.deltaDecorations(decorationIds, compute());
  });
  return {
    dispose: () => {
      subscription.dispose();
      model.deltaDecorations(decorationIds, []);
    },
  };
};

const findModelById = (
  modelId: string,
): monaco.editor.ITextModel | undefined =>
  monacoRuntime.editor
    .getModels()
    .find((candidate) => candidate.uri.toString().includes(modelId));

export type TypefoxEditorProps = {
  /** Stable identity for the underlying editor app + model uri. */
  id: string;
  /** Initial source rendered in the editor. */
  value: string;
  /** Notified with the latest editor text whenever it changes. */
  onChange?: (value: string) => void;
  /** Editor language. Defaults to `typescript`. */
  language?: CodeEditorLanguage;
  /** Minimum editor height in pixels. Defaults to 240. */
  minHeight?: number;
  /**
   * When true, the editor container fills its flex parent (`height: 100%`)
   * instead of using a fixed `minHeight` px height, so it grows to fit a tall
   * flex column (e.g. the popout dialog body). `minHeight` is still applied as
   * a floor. Defaults to false, preserving the inline fixed-height behaviour.
   */
  fillHeight?: boolean;
  /**
   * Generated ambient type definitions (the `context.d.ts`) injected as a TS
   * extra-lib so `context.*` resolves with real fields. Wired up once per
   * editor at mount, keyed by a unique path - no addExtraLib race.
   * Only used for `typescript` / `javascript` editors.
   */
  typeDefinitions?: string;
  /**
   * Template properties for non-script editors. When provided, typing `{{`
   * autocompletes the available `{{ path }}` references. Only used for
   * markup/text editors (json / yaml / xml / markdown).
   */
  templateProperties?: TemplateProperty[];
  /**
   * Environment-variable hints for `shell` editors. When provided, typing `$`
   * or `${` autocompletes the variable names. Only used when `language` is
   * `shell`.
   */
  shellEnvVars?: ShellEnvVar[];
  /**
   * Externally-computed diagnostics rendered as inline squiggles under a
   * dedicated marker owner (so they coexist with monaco's own markers).
   * Positions are 1-based (monaco convention) - e.g. YAML definition validation.
   */
  markers?: EditorMarker[];
  /** Render the editor read-only. */
  readOnly?: boolean;
  /** Accessible label / hint for the editor (surfaced via aria-label). */
  placeholder?: string;
  /**
   * Lazy Automatic Type Acquisition resolver. When provided (TS/JS editors),
   * bare `import`/`require` specifiers in the buffer are parsed (debounced)
   * and each NEW package's `.d.ts` closure is fetched + registered so e.g.
   * `import { debounce } from "lodash"` autocompletes. Injected by the
   * consumer so this component stays plugin-agnostic.
   */
  acquireTypes?: AcquireTypes;
  /**
   * Install identity (lockfile hash). When it changes, the shared acquired-set
   * resets so types refresh against the new install.
   */
  acquireResetKey?: string;
  /**
   * The running release's `@checkstack/sdk` editor bundle, as virtual `.d.ts`
   * files to mount (TS/JS editors). Makes `import { defineHealthCheck } from
   * "@checkstack/sdk/healthcheck"` resolve with real, version-matched types.
   * Each file mounts at `file:///<path>` via `addExtraLib`. Fetched live by the
   * consumer (so this component stays network-agnostic + DOM-test-free).
   */
  sdkTypes?: ReadonlyArray<{ path: string; content: string }>;
  /**
   * Release-version reset key for `sdkTypes`. When it changes, the previously
   * mounted SDK libs are reset so the editor never serves stale SDK types after
   * a deployment upgrade.
   */
  sdkTypesResetKey?: string;
  /**
   * Importable installed package NAMES (TS/JS editors). When provided, the
   * editor suggests these as completions while the cursor is inside an import
   * specifier string (`import {} from "lod"` -> `lodash`) - solving the
   * lazy-ATA catch-22 where no module is registered yet. Must already exclude
   * `@types/*` companions (you import `lodash`, never `@types/lodash`).
   * Injected by the consumer so this component stays plugin-agnostic.
   */
  importablePackages?: string[];
  /**
   * When `true`, this editor never CLAIMS the one-time global cold init - it
   * always waits for another (visible) editor to bring the monaco-vscode
   * services up, then mounts. Set this for OFFSCREEN/hidden editors (the
   * automation `ScriptServicesBooter`): a hidden editor's init may never
   * complete, so it must not be the sole initializer. Defaults to `false`.
   */
  deferInit?: boolean;
};

/**
 * Isolated editor used to validate the Typefox/monaco-vscode stack in the
 * browser. Theme follows `useTheme().resolvedTheme` (`vs` in light mode,
 * `vs-dark` in dark mode), no minimap, automatic layout, word-based suggestions
 * disabled. For `typescript`/`javascript` it injects the `context` types +
 * bracket completions; for markup/text languages it offers `{{ }}` template
 * completions.
 */
// The standalone ("classic") service set omits `ILanguageStatusService`, but
// the JSON language features register a language-status indicator (the active
// formatter) on editor focus and throw "LanguageStatusService.addStatus is not
// supported" without it. We register ONLY that service: the full languages
// override would also swap `ILanguageService` for the workbench impl and pull
// in the files-service override, both of which conflict with the standalone
// language setup. The override map is keyed by the service-decorator id
// (`createDecorator('ILanguageStatusService')`), so we pick that one entry.
const LANGUAGE_STATUS_SERVICE_ID = "ILanguageStatusService";
const languageStatusServiceOverride: monaco.editor.IEditorOverrideServices =
  (() => {
    const all = getLanguagesServiceOverride();
    return LANGUAGE_STATUS_SERVICE_ID in all
      ? { [LANGUAGE_STATUS_SERVICE_ID]: all[LANGUAGE_STATUS_SERVICE_ID] }
      : {};
  })();

// The monaco-vscode global API config. Hoisted to module scope (it has no
// per-editor state) so it can drive a single, app-lifetime global init below.
const vscodeApiConfig: MonacoVscodeApiConfig = {
  // 'classic' is the standalone axis (no extension host); 'extended' is the
  // extension-host axis we deliberately avoid in this migration.
  $type: "classic",
  // Register the missing ILanguageStatusService (see the override above) so
  // focusing a JSON editor doesn't throw "addStatus is not supported".
  serviceOverrides: { ...languageStatusServiceOverride },
  // Plain editor, no workbench views.
  viewsConfig: { $type: "EditorService" },
  monacoWorkerFactory: ensureStandaloneWorkerFactory,
};

// ─── How the global monaco-vscode init is serialized ────────────────────────
//
// `@codingame/monaco-vscode-api`'s global `initialize()` is ONE-SHOT and can
// never be torn down or re-run. `@typefox/monaco-editor-react` performs that
// init itself when a `MonacoEditorReactComp` is given a `vscodeApiConfig`, and
// that is StrictMode-safe FOR A SINGLE EDITOR (upstream tests cover exactly
// that). The breakage is two editors on one page (e.g. an open script-action
// editor PLUS the hidden `ScriptServicesBooter`): both wrappers race the init
// guard (only set inside an async `start()`), both call `initialize()`, the
// second throws "Services are already initialized", and the global state is
// corrupted so NO editor starts. StrictMode (dev only) makes the race
// deterministic via mount -> unmount -> remount; production works because
// StrictMode is a no-op there.
//
// Fix (per the maintainers' single-editor-init guidance): exactly ONE editor
// claims the cold init and mounts WITH `vscodeApiConfig` (the proven path);
// every other editor waits for `areVscodeServicesReady()` and only then mounts
// (it still passes `vscodeApiConfig`, but @typefox no-ops since the services
// are already initialized). The hidden booter sets `deferInit` so it never
// claims - the claimer must be a real, visible editor whose init can complete.

// Always-available runtime built-in import specifiers (Node + Bun), derived at
// build time from the bundled stdlib types. These are importable in the script
// sandbox regardless of the installed-package allowlist (the sandbox is a Bun
// subprocess; Bun provides Node's builtins + its own `bun:` modules), and their
// types are already loaded ambiently via the stdlib bundle - so completing one
// needs no lazy acquisition. The JSON is a plain `string[]`.
const BUILTIN_MODULE_SPECIFIERS: readonly string[] = builtinModulesJson;

// Passed as the wrapper's `onError` so a wrapper failure is surfaced here
// instead of becoming an uncaught promise rejection (and so @typefox doesn't
// reset its internal run-queue lock + re-throw).
const handleEditorError = (error: Error): void => {
  console.error("[CodeEditor] monaco editor error:", error);
};

export const TypefoxEditor = ({
  id,
  value,
  onChange,
  language = "typescript",
  minHeight = 240,
  fillHeight = false,
  typeDefinitions,
  templateProperties,
  shellEnvVars,
  markers,
  readOnly = false,
  placeholder,
  acquireTypes,
  acquireResetKey,
  sdkTypes,
  sdkTypesResetKey,
  importablePackages,
  deferInit = false,
}: TypefoxEditorProps) => {
  // Follow the app's resolved theme so the editor uses `vs` (light) or
  // `vs-dark` (dark) and updates live when the user toggles the theme.
  const { resolvedTheme } = useTheme();
  const monacoTheme = MONACO_THEME_MAP[resolvedTheme];

  // `MonacoEditorReactComp` captures `onTextChanged` once at editor-start, so
  // the handler it calls would otherwise close over a stale `onChange` (bound
  // to the value/sibling-config at mount time). Routing through a ref that we
  // keep current on every render means content changes always invoke the
  // latest `onChange` — without this, editing one DynamicForm field reverts
  // sibling fields (e.g. a shell action's `env`) to their mount-time values.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Unique-per-instance id so multiple editors never share a model or clobber
  // each other's extra-lib.
  const reactId = useId();
  const modelId = `${id}-${reactId.replaceAll(":", "")}`;
  const modelUri = `/workspace/${modelId}.${LANGUAGE_FILE_EXT[language]}`;

  const isTsLike = isTsLikeLanguage(language);
  const hasTemplates =
    templateProperties !== undefined && templateProperties.length > 0;
  const languageId = MONACO_LANGUAGE_ID[language];

  // Set once the wrapper has initialised the VS Code services, so the
  // completion providers below register against a ready languages registry.
  const [apiReady, setApiReady] = useState(false);

  // Cold-init serialization (see the block comment above). Tracks whether the
  // global services are up yet, and whether THIS editor is the designated
  // initializer (the one that mounts first, with `vscodeApiConfig`).
  const [servicesReady, setServicesReady] = useState(() =>
    areVscodeServicesReady(),
  );
  const [isInitializer, setIsInitializer] = useState(false);
  useEffect(() => {
    if (servicesReady) return;
    return onVscodeServicesReady(() => setServicesReady(true));
  }, [servicesReady]);
  // Decide the initializer role in a layout effect (NOT during render) so it is
  // StrictMode-safe: StrictMode runs setup -> cleanup -> setup, and the cleanup
  // releases the claim, so exactly one editor ends up the stable holder. A
  // `deferInit` editor (the hidden booter) never claims - the initializer must
  // be a real, visible editor whose @typefox init can actually complete.
  useLayoutEffect(() => {
    if (areVscodeServicesReady() || deferInit) return;
    const claimed = claimColdInit();
    setIsInitializer(claimed);
    return () => {
      if (claimed) releaseColdInit();
    };
  }, [deferInit]);

  // Mount the wrapper when the services are ready (we attach to them) OR when we
  // are the initializer (we bring them up, passing `vscodeApiConfig`). Until
  // then, a sized, non-animated placeholder so the layout doesn't jump.
  const canMountWrapper = servicesReady || isInitializer;

  // Keep the Monaco global theme and the variable-token decoration color in
  // sync whenever the resolved app theme changes. Monaco's theme is a global
  // imperative setting (not per-editor), so re-deriving `editorAppConfig`
  // alone is not enough after the editor has started - this effect is what
  // makes live toggling work.
  //
  // GATED on `apiReady`: `monaco.editor.setTheme()` resolves a service via
  // `StandaloneServices.get()`, which AUTO-INITIALIZES the monaco-vscode
  // services if they aren't up yet (CodinGame standaloneServices.js:963). If
  // this ran before the wrapper's own init (e.g. on the deferred booter, which
  // mounts but never gets `apiReady`), it would trip CodinGame's
  // `servicesInitialized` flag and make the wrapper's later `initialize()` throw
  // "Services are already initialized". The initial theme is already applied via
  // `editorAppConfig.editorOptions.theme`; this effect only handles live
  // toggling, which is always after the editor (and thus the API) has started.
  useEffect(() => {
    if (!apiReady) return;
    monacoRuntime.editor.setTheme(monacoTheme);
    ensureVariableTokenStyle({ resolvedTheme });
  }, [apiReady, resolvedTheme, monacoTheme]);

  useEffect(() => {
    // GATED on `apiReady` for the same reason as the theme effect above:
    // touching `typescriptDefaults` before the wrapper init can auto-initialize
    // the services and collide with the wrapper's `initialize()`.
    if (!apiReady || !isTsLike || typeDefinitions === undefined) {
      return;
    }
    // Inject this editor's ambient `context` types. addExtraLib keys by path
    // and re-syncs the worker on change, so the types are reliably picked up
    // (no race with model load). NOTE: extra-libs are ambient/global to the TS
    // service, so two TS editors with *different* `context` shapes mounted at
    // once would collide on the `context` identifier - per-editor isolation is
    // a Stage 6 concern, irrelevant to the single-editor test vehicle here.
    const lib = typescriptDefaults.addExtraLib(
      typeDefinitions,
      `file:///context-${modelId}.d.ts`,
    );
    return () => {
      lib.dispose();
    };
  }, [apiReady, isTsLike, typeDefinitions, modelId]);

  // Mount the @checkstack/sdk editor bundle (script helpers + typed client) so
  // `import ... from "@checkstack/sdk/healthcheck"` resolves with real types.
  // Shared/module-scoped + reset-on-version (mountSdkTypes); the fetch lives in
  // the consumer so this component is network-agnostic + DOM-test-free.
  useEffect(() => {
    if (!apiReady || !isTsLike || sdkTypes === undefined) {
      return;
    }
    mountSdkTypes({ files: sdkTypes, resetKey: sdkTypesResetKey });
  }, [apiReady, isTsLike, sdkTypes, sdkTypesResetKey]);

  // Lazy Automatic Type Acquisition (ATA). For TS/JS editors with an injected
  // `acquireTypes` resolver, parse the buffer's bare import/require specifiers
  // (debounced) and fetch + register each NEW package's `.d.ts` closure, so
  // `import { x } from "pkg"` autocompletes. The acquired-set is module-scoped
  // and shared across editors (the declarations are install-global); the pure
  // parse/plan steps are unit-tested in importSpecifiers.test.ts. Re-running
  // on a new `acquireTypes`/`acquireResetKey` identity is cheap and safe — the
  // module-scoped acquired-set dedupes, so it never double-fetches.
  useEffect(() => {
    if (!apiReady || !isTsLike || acquireTypes === undefined) {
      return;
    }
    const model = findModelById(modelId);
    if (!model) {
      return;
    }

    const acquire = (source: string): void => {
      void runTypeAcquisition({
        source,
        acquireTypes,
        resetKey: acquireResetKey,
      });
    };

    // Run once for the initial content so existing imports resolve on open.
    acquire(model.getValue());

    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = model.onDidChangeContent(() => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        acquire(model.getValue());
      }, 400);
    });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      subscription.dispose();
    };
  }, [apiReady, isTsLike, acquireTypes, acquireResetKey, modelId]);

  // Controlled-value sync. `value` is only seeded into the model at mount
  // (codeResources), so the editor is otherwise uncontrolled. Apply external
  // `value` changes — a sibling editor's edits (the inline ↔ popout pair share
  // one controlled `value`), a YAML→Visual reset, a loaded definition — to this
  // model. Guarded by an equality check: the user's own edit round-trips
  // `value === model.getValue()`, so the actively-edited editor is a no-op and
  // there is no feedback loop; only a background editor whose `value` prop
  // diverged gets updated.
  useEffect(() => {
    if (!apiReady) return;
    const model = findModelById(modelId);
    if (!model || model.getValue() === value) return;
    model.setValue(value);
  }, [apiReady, modelId, value]);

  // Import-specifier name completions. Lazy ATA only registers a package's
  // types AFTER its name is in the buffer, so while the user is still TYPING
  // the specifier (`import {} from "lod"`) no module exists yet and the TS
  // worker offers nothing. This provider fills that gap: when the cursor is
  // inside an import/require string (detected by the unit-tested
  // `importSpecifierCompletionContext`), it suggests:
  //   - the always-available runtime built-ins (`node:fs`, `bun`, ...), so
  //     they appear even with an empty allowlist; AND
  //   - the injected installed-package names (already `@types/*`-free).
  // Selecting a built-in inserts an already-typed module; selecting an
  // installed package triggers the ATA loop to load its closure. The list is
  // merged + deduped + sorted by `mergeImportCompletionEntries` (a unit-tested
  // pure helper). Built-ins read as "Node.js" / "Bun built-in" via `detail`.
  // Scoped to THIS model; only the import-string position triggers it, so it
  // never pollutes normal completions. Always registered (built-ins are
  // always available), independent of the allowlist.
  useEffect(() => {
    if (!apiReady || !isTsLike) {
      return;
    }
    const entries = mergeImportCompletionEntries({
      builtins: BUILTIN_MODULE_SPECIFIERS,
      installedPackages: importablePackages ?? [],
    });

    const provideCompletionItems = (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.CompletionList => {
      if (!model.uri.toString().includes(modelId)) {
        return { suggestions: [] };
      }
      const lineUpToCursor = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1);
      const ctx = importSpecifierCompletionContext(lineUpToCursor);
      if (!ctx) {
        return { suggestions: [] };
      }
      // Replace the whole partial specifier (between the quotes) without
      // touching the quotes themselves.
      const range = {
        startLineNumber: position.lineNumber,
        startColumn: ctx.replaceFromColumn,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };
      return {
        suggestions: entries.map((entry) => ({
          label: entry.name,
          kind: monacoRuntime.languages.CompletionItemKind.Module,
          detail: entry.detail,
          insertText: entry.name,
          filterText: entry.name,
          range,
        })),
        // The list is the full known set; let monaco filter by `partial`.
        incomplete: false,
      };
    };

    const disposables = (["typescript", "javascript"] as const).map((lang) =>
      monacoRuntime.languages.registerCompletionItemProvider(lang, {
        // Opening quotes start a specifier; `:` advances into a `node:`/`bun:`
        // builtin; `/` advances into a scoped name or subpath.
        triggerCharacters: ['"', "'", "/", ":"],
        provideCompletionItems,
      }),
    );
    return () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    };
  }, [apiReady, isTsLike, importablePackages, modelId]);

  // Type-driven bracket-notation completions. The standalone TS worker omits
  // object members whose keys aren't valid identifiers (artifact ids like
  // `integration-jira.issue`), and the built-in SuggestAdapter can't be
  // overridden to insert them, so we register our own provider: typing
  // `<objectExpression>.` lists the keys and accepting one rewrites the dot to
  // `["key"]` (mirrors VS Code's `obj."a-b"` -> `obj["a-b"]`). The groups are
  // derived from the injected `context.d.ts` itself, so no separate prop is
  // threaded. Scoped to THIS editor's model so multiple editors don't cross-feed.
  useEffect(() => {
    if (!apiReady || !isTsLike || typeDefinitions === undefined) {
      return;
    }
    const groups = extractBracketKeyGroups({ typeDefinitions });
    if (groups.length === 0) {
      return;
    }

    const escapeRegExp = (input: string): string =>
      input.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

    const provideCompletionItems = (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.CompletionList => {
      if (!model.uri.toString().includes(modelId)) {
        return { suggestions: [] };
      }
      const textBefore = model
        .getLineContent(position.lineNumber)
        .slice(0, position.column - 1);

      for (const { objectExpression, keys } of groups) {
        // Match `<objectExpression>.<query>` at the cursor, ensuring the
        // expression isn't the tail of a longer identifier.
        const match = new RegExp(
          String.raw`(?:^|[^\w$.])${escapeRegExp(objectExpression)}\.([\w$]*)$`,
        ).exec(textBefore);
        if (!match) {
          continue;
        }
        const query = match[1] ?? "";
        const queryStartColumn = position.column - query.length;
        const dotColumn = queryStartColumn - 1;

        return {
          suggestions: keys.map((key) => ({
            label: `["${key}"]`,
            kind: monacoRuntime.languages.CompletionItemKind.Property,
            detail: objectExpression,
            insertText: `["${key}"]`,
            filterText: key,
            range: {
              startLineNumber: position.lineNumber,
              startColumn: queryStartColumn,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
            // Delete the triggering `.` so `obj.` becomes `obj["key"]`.
            additionalTextEdits: [
              {
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: dotColumn,
                  endLineNumber: position.lineNumber,
                  endColumn: dotColumn + 1,
                },
                text: "",
              },
            ],
          })),
        };
      }
      return { suggestions: [] };
    };

    const disposables = (["typescript", "javascript"] as const).map((lang) =>
      monacoRuntime.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ["."],
        provideCompletionItems,
      }),
    );
    return () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    };
  }, [apiReady, isTsLike, typeDefinitions, modelId]);

  // Template `{{ }}` completion for markup/text editors (json / yaml / xml /
  // markdown). Typing `{{` lists the available `{{ path }}` references; ported
  // from the legacy MonacoEditor template provider (uses the same tested
  // `detectOpenTemplate` / `detectAutoClosedBraces` helpers). Registered for
  // THIS editor's resolved language id and scoped to its model.
  useEffect(() => {
    if (!apiReady || isTsLike || !hasTemplates) {
      return;
    }
    const properties = templateProperties ?? [];

    const provideCompletionItems = (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.CompletionList => {
      if (!model.uri.toString().includes(modelId)) {
        return { suggestions: [] };
      }
      const content = model.getValue();
      const cursorOffset = model.getOffsetAt(position);

      const openTemplate = detectOpenTemplate({ content, cursorOffset });
      if (!openTemplate.isInTemplate) {
        return { suggestions: [] };
      }

      const query = openTemplate.query.toLowerCase();
      const startColumn = openTemplate.startColumn;
      // Monaco may have auto-closed with `}}` after the cursor; extend the
      // replaced range over it so we don't leave dangling braces.
      const endColumn =
        position.column + detectAutoClosedBraces({ content, cursorOffset });

      const suggestions = properties
        .filter(
          (prop) => query === "" || prop.path.toLowerCase().includes(query),
        )
        .map((prop, index) => ({
          label: `{{${prop.path}}}`,
          kind: monacoRuntime.languages.CompletionItemKind.Variable,
          detail: prop.type,
          documentation: prop.description,
          insertText: `{{${prop.path}}}`,
          // Leading space sorts these above the editor's own suggestions.
          sortText: ` ${String(index).padStart(4, "0")}`,
          filterText: `{{${query}${prop.path}`,
          preselect: index === 0,
          range: {
            startLineNumber: position.lineNumber,
            startColumn,
            endLineNumber: position.lineNumber,
            endColumn,
          },
        }));

      return { suggestions, incomplete: false };
    };

    const provider = monacoRuntime.languages.registerCompletionItemProvider(
      languageId,
      { triggerCharacters: ["{"], provideCompletionItems },
    );
    return () => {
      provider.dispose();
    };
  }, [
    apiReady,
    isTsLike,
    hasTemplates,
    templateProperties,
    languageId,
    modelId,
  ]);

  // Highlight `{{ ... }}` template expressions (template editors). The
  // `[^{}]*` body (not `[^}]*`) stops an unclosed `{{` from swallowing text up
  // to a later `}}`.
  useEffect(() => {
    if (!apiReady || isTsLike || !hasTemplates) {
      return;
    }
    const model = findModelById(modelId);
    if (!model) {
      return;
    }
    const handle = installRegexDecorations({
      model,
      pattern: /\{\{[^{}]*\}\}/g,
      className: VARIABLE_TOKEN_CLASS,
    });
    return () => {
      handle.dispose();
    };
  }, [apiReady, isTsLike, hasTemplates, modelId]);

  // Highlight shell variable references (`$NAME` / `${NAME}`) - the shell
  // grammar doesn't color these inside double-quoted strings, where ours live.
  useEffect(() => {
    if (!apiReady || language !== "shell") {
      return;
    }
    const model = findModelById(modelId);
    if (!model) {
      return;
    }
    const handle = installRegexDecorations({
      model,
      pattern: /\$\{[A-Za-z_]\w*\}|\$[A-Za-z_]\w*/g,
      className: VARIABLE_TOKEN_CLASS,
    });
    return () => {
      handle.dispose();
    };
  }, [apiReady, language, modelId]);

  // Shell `$env` completion. For `shell` editors, typing `$` or `${` suggests
  // the provided variable names (and brace-closes `${name}` correctly). Ported
  // from the legacy MonacoEditor shell provider; uses the tested
  // `matchShellEnvVarTrigger` / `buildShellEnvVarInsertText` helpers.
  useEffect(() => {
    if (!apiReady || language !== "shell") {
      return;
    }
    if (shellEnvVars === undefined || shellEnvVars.length === 0) {
      return;
    }
    const envVars = shellEnvVars;

    const provideCompletionItems = (
      model: monaco.editor.ITextModel,
      position: monaco.Position,
    ): monaco.languages.CompletionList => {
      if (!model.uri.toString().includes(modelId)) {
        return { suggestions: [] };
      }
      const lineText = model.getLineContent(position.lineNumber);
      const textBefore = lineText.slice(0, position.column - 1);
      const match = matchShellEnvVarTrigger(textBefore);
      if (!match) {
        return { suggestions: [] };
      }
      const startColumn = position.column - match.prefixLength;
      // `{` auto-closes to `}` in shell, so a braced `${` leaves a `}` right
      // after the cursor. Extend the replace range over it so an accepted
      // `${NAME}` doesn't leave a stray brace (`${NAME}}`).
      const hasAutoClosedBrace =
        match.form === "braced" && lineText[position.column - 1] === "}";
      const endColumn = hasAutoClosedBrace
        ? position.column + 1
        : position.column;
      // filterText must match the text already in the replace range (`${` for
      // braced, `$` for bare) or monaco fuzzy-filters every item out.
      const filterPrefix = match.form === "braced" ? "${" : "$";

      const suggestions = envVars
        .filter(
          (v) => match.query === "" || v.name.toUpperCase().includes(match.query),
        )
        .map((v, index) => ({
          label: `$${v.name}`,
          kind: monacoRuntime.languages.CompletionItemKind.Variable,
          detail: v.example ? `e.g. ${v.example}` : "shell env var",
          // Full name in the (wrapping) docs panel so long CHECKSTACK_* names
          // stay legible even when the suggest-list label truncates.
          documentation: {
            value: [`\`$${v.name}\``, v.description].filter(Boolean).join("\n\n"),
          },
          insertText: buildShellEnvVarInsertText(match, v.name),
          sortText: ` ${String(index).padStart(4, "0")}`,
          filterText: `${filterPrefix}${v.name}`,
          range: {
            startLineNumber: position.lineNumber,
            startColumn,
            endLineNumber: position.lineNumber,
            endColumn,
          },
        }));

      return { suggestions, incomplete: false };
    };

    const provider = monacoRuntime.languages.registerCompletionItemProvider("shell", {
      triggerCharacters: ["$", "{"],
      provideCompletionItems,
    });
    return () => {
      provider.dispose();
    };
  }, [apiReady, language, shellEnvVars, modelId]);

  // External validation markers (inline squiggles). Applied under a dedicated
  // owner so they coexist with monaco's own language markers. Ported from the
  // legacy editor; used e.g. for YAML definition validation in AutomationEditPage.
  useEffect(() => {
    if (!apiReady) {
      return;
    }
    const model = monacoRuntime.editor
      .getModels()
      .find((candidate) => candidate.uri.toString().includes(modelId));
    if (!model) {
      return;
    }
    const toSeverity = (
      severity: EditorMarker["severity"],
    ): monaco.MarkerSeverity => {
      if (severity === "warning") {
        return monacoRuntime.MarkerSeverity.Warning;
      }
      if (severity === "info") {
        return monacoRuntime.MarkerSeverity.Info;
      }
      return monacoRuntime.MarkerSeverity.Error;
    };
    monacoRuntime.editor.setModelMarkers(
      model,
      "external-validation",
      (markers ?? []).map((marker) => ({
        startLineNumber: marker.startLineNumber,
        startColumn: marker.startColumn,
        endLineNumber: marker.endLineNumber,
        endColumn: marker.endColumn,
        message: marker.message,
        severity: toSeverity(marker.severity),
      })),
    );
    return () => {
      monacoRuntime.editor.setModelMarkers(model, "external-validation", []);
    };
  }, [apiReady, markers, modelId]);

  // Template-aware validation for markup languages (json / yaml / xml). The
  // language services' own validation is off (json) or absent (yaml/xml);
  // instead we validate the template-substituted form so `{{ }}` is allowed in
  // any position while real structural errors are still flagged. Recomputed on
  // every edit. Under a dedicated owner so it coexists with the external
  // `markers`.
  useEffect(() => {
    const validate = TEMPLATE_VALIDATORS[language];
    if (!apiReady || !validate) {
      return;
    }
    const model = findModelById(modelId);
    if (!model) {
      return;
    }
    const owner = "template-validation";
    const runValidation = (): void => {
      const diagnostics = validate(model.getValue());
      monacoRuntime.editor.setModelMarkers(
        model,
        owner,
        diagnostics.map((diagnostic) => {
          const start = model.getPositionAt(diagnostic.offset);
          const end = model.getPositionAt(
            diagnostic.offset + diagnostic.length,
          );
          return {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
            message: diagnostic.message,
            severity: monacoRuntime.MarkerSeverity.Error,
          };
        }),
      );
    };
    runValidation();
    const subscription = model.onDidChangeContent(() => {
      runValidation();
    });
    return () => {
      subscription.dispose();
      monacoRuntime.editor.setModelMarkers(model, owner, []);
    };
  }, [apiReady, language, modelId]);

  const editorAppConfig: EditorAppConfig = {
    // Unique per instance (modelId includes a useId suffix) so multiple editors
    // sharing the same `id` prop don't collide in the wrapper's app registry.
    id: modelId,
    codeResources: {
      modified: {
        text: value,
        uri: modelUri,
        enforceLanguageId: languageId,
      },
    },
    editorOptions: {
      // Derived from useTheme().resolvedTheme: "vs" for light, "vs-dark" for
      // dark. These are the two built-in classic themes available in the
      // standalone setup (the VS Code 'Default Dark Modern' theme requires the
      // extension-host theme-defaults extension, which the standalone setup
      // omits).
      theme: monacoTheme,
      minimap: { enabled: false },
      automaticLayout: true,
      // Force completions to come from the TS language service rather than
      // naive word matching.
      wordBasedSuggestions: "off",
      scrollBeyondLastLine: false,
      readOnly,
      ariaLabel: placeholder ?? "Code editor",
    },
  };

  const handleTextChanged = (textChanges: TextContents): void => {
    onChangeRef.current?.(textChanges.modified ?? "");
  };

  // In `fillHeight` mode the container takes its parent's height so Monaco's
  // `automaticLayout` resizes to fill a tall flex column (the popout body);
  // `minHeight` stays as a floor. Otherwise the inline fixed-px behaviour is
  // preserved exactly.
  const containerStyle: CSSProperties = fillHeight
    ? { minHeight: `${minHeight}px`, height: "100%" }
    : { minHeight: `${minHeight}px`, height: `${minHeight}px` };

  // Non-initializer editors wait for the services to be up before mounting (a
  // sized, non-animated placeholder until then, so the layout doesn't jump).
  // The initializer mounts immediately and brings the services up.
  if (!canMountWrapper) {
    return (
      <div
        style={containerStyle}
        className="w-full rounded-md bg-muted"
        aria-busy="true"
        aria-label={placeholder ?? "Loading editor"}
      />
    );
  }

  return (
    <MonacoEditorReactComp
      style={containerStyle}
      vscodeApiConfig={vscodeApiConfig}
      editorAppConfig={editorAppConfig}
      onTextChanged={handleTextChanged}
      // Route wrapper errors to our handler rather than letting @typefox reset
      // its run-queue lock and re-throw as an uncaught rejection (recommended by
      // the monaco-languageclient maintainers).
      onError={handleEditorError}
      onEditorStartDone={() => {
        // Per-editor ready signal for the completion providers. We use this
        // (not onVscodeApiInitDone) because the vscode API initialises globally
        // once, so a second editor never gets its own onVscodeApiInitDone - but
        // onEditorStartDone fires for each editor instance.
        setApiReady(true);
        // The monaco-vscode services are now up. Let the headless script
        // validator know it may safely use the worker (it must never init the
        // services itself - that would collide with this wrapper's one-time
        // init and throw "Services are already initialized").
        markVscodeServicesReady();
      }}
    />
  );
};
