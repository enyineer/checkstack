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
// The named imports below ALSO trigger this package's side-effect registration
// of the standalone TypeScript language features (defaults + ts.worker). We use
// them to configure the TS/JS language services + inject ambient context types.
import {
  typescriptDefaults,
  javascriptDefaults,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
} from "@codingame/monaco-vscode-standalone-typescript-language-features";
// Named import also triggers the side-effect registration of the REAL VS Code
// JSON language service (proper highlighting + completion + folding), replacing
// the hand-rolled `json-template` Monarch grammar. We turn its built-in
// (raw-text) validation OFF and validate the template-substituted form instead
// (see validateJsonTemplate), so templates work in any position - including
// unquoted ones like a numeric `"timeout": {{x}}`.
import { jsonDefaults } from "@codingame/monaco-vscode-standalone-json-language-features";

// Worker entry URLs, bundled and resolved by Vite via the `?worker&url`
// suffix. We import them as URL STRINGS (not Worker constructors) because
// monaco-languageclient's worker factory consumes `loader().url.toString()`.
// Vite's STATIC `?worker&url` resolution is required here: a runtime
// `new URL(specifier, import.meta.url)` would resolve the bare specifier
// relative to THIS source file (e.g. core/ui/src/components/CodeEditor/...)
// and 404. The editor worker comes from the monaco-editor drop-in
// (@codingame/monaco-vscode-editor-api); the TypeScript worker (which also
// serves JavaScript) from the standalone language-features package.
import editorWorkerUrl from "@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js?worker&url";
import tsWorkerUrl from "@codingame/monaco-vscode-standalone-typescript-language-features/worker?worker&url";
import jsonWorkerUrl from "@codingame/monaco-vscode-standalone-json-language-features/worker?worker&url";

import { useEffect, useId, useState } from "react";
import * as monaco from "@codingame/monaco-vscode-editor-api";
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
  CodeEditorLanguage,
  EditorMarker,
  ShellEnvVar,
  TemplateProperty,
} from "./types";
import {
  type EditorAppConfig,
  type TextContents,
} from "monaco-languageclient/editorApp";
import { type MonacoVscodeApiConfig } from "monaco-languageclient/vscodeApiWrapper";
import {
  // `useWorkerFactory` is a plain library registration function, not a React
  // hook. We alias away the `use` prefix so the `react-hooks/rules-of-hooks`
  // lint rule (which keys purely off the identifier name) does not misfire.
  useWorkerFactory as registerWorkerFactory,
  Worker,
  type WorkerFactoryConfig,
  type WorkerLoader,
} from "monaco-languageclient/workerFactory";

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

/**
 * Registers the worker loaders required for the standalone (classic) Monaco
 * setup. We only need the generic editor worker plus the TypeScript worker
 * (which also serves JavaScript). Mirrors the upstream `defineClassicWorkers`
 * helper referenced above. The underlying `useWorkerFactory` export is a
 * plain library registration function (not a React hook) despite its name;
 * it is called from module scope here, never from a component render.
 */
const configureStandaloneWorkerFactory = (
  logger?: WorkerFactoryLogger,
): void => {
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
const BASE_COMPILER_OPTIONS = {
  target: ScriptTarget.ESNext,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.NodeJs,
  lib: ["esnext"],
  allowNonTsExtensions: false,
  noEmit: true,
  strict: true,
  esModuleInterop: true,
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
 * `Bun`, etc. typed (parity with the legacy editor). The ~3 MB bundle is
 * code-split into its own chunk and fetched once. Ported from the legacy
 * `monacoStdlib.ts` (without its `@monaco-editor/react` dependency). Runs at
 * module load; this file is browser-only so the dynamic import is safe here.
 */
let stdlibLoadStarted = false;
const ensureStandaloneStdlib = async (): Promise<void> => {
  if (stdlibLoadStarted) {
    return;
  }
  stdlibLoadStarted = true;
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
};

void ensureStandaloneStdlib();

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
// doesn't color `$VAR` inside strings) and keeps the color consistent. #9cdcfe
// is the vs-dark `variable` token color, matching json-template's grammar. The
// CSS class is injected once.
const VARIABLE_TOKEN_CLASS = "checkstack-editor-variable";
let variableTokenStyleInjected = false;
const ensureVariableTokenStyle = (): void => {
  if (variableTokenStyleInjected) {
    return;
  }
  variableTokenStyleInjected = true;
  const style = document.createElement("style");
  // `!important` so the decoration color always wins over the underlying token
  // color (.mtkN), making `{{ }}` look identical inside and outside strings.
  style.textContent = `.${VARIABLE_TOKEN_CLASS}{color:#9cdcfe !important;}`;
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
  ensureVariableTokenStyle();
  const compute = (): monaco.editor.IModelDeltaDecoration[] => {
    const text = model.getValue();
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match !== null) {
      const start = model.getPositionAt(match.index);
      const end = model.getPositionAt(match.index + match[0].length);
      decorations.push({
        range: new monaco.Range(
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
  monaco.editor
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
};

/**
 * Isolated editor used to validate the Typefox/monaco-vscode stack in the
 * browser. Dark theme, no minimap, automatic layout, word-based suggestions
 * disabled. For `typescript`/`javascript` it injects the `context` types +
 * bracket completions; for markup/text languages it offers `{{ }}` template
 * completions.
 */
export const TypefoxEditor = ({
  id,
  value,
  onChange,
  language = "typescript",
  minHeight = 240,
  typeDefinitions,
  templateProperties,
  shellEnvVars,
  markers,
  readOnly = false,
  placeholder,
}: TypefoxEditorProps) => {
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

  useEffect(() => {
    if (!isTsLike || typeDefinitions === undefined) {
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
  }, [isTsLike, typeDefinitions, modelId]);

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
            kind: monaco.languages.CompletionItemKind.Property,
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
      monaco.languages.registerCompletionItemProvider(lang, {
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
          kind: monaco.languages.CompletionItemKind.Variable,
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

    const provider = monaco.languages.registerCompletionItemProvider(
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
          kind: monaco.languages.CompletionItemKind.Variable,
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

    const provider = monaco.languages.registerCompletionItemProvider("shell", {
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
    const model = monaco.editor
      .getModels()
      .find((candidate) => candidate.uri.toString().includes(modelId));
    if (!model) {
      return;
    }
    const toSeverity = (
      severity: EditorMarker["severity"],
    ): monaco.MarkerSeverity => {
      if (severity === "warning") {
        return monaco.MarkerSeverity.Warning;
      }
      if (severity === "info") {
        return monaco.MarkerSeverity.Info;
      }
      return monaco.MarkerSeverity.Error;
    };
    monaco.editor.setModelMarkers(
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
      monaco.editor.setModelMarkers(model, "external-validation", []);
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
      monaco.editor.setModelMarkers(
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
            severity: monaco.MarkerSeverity.Error,
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
      monaco.editor.setModelMarkers(model, owner, []);
    };
  }, [apiReady, language, modelId]);

  const vscodeApiConfig: MonacoVscodeApiConfig = {
    // 'classic' is the standalone axis (no extension host); 'extended' is the
    // extension-host axis we deliberately avoid in this migration.
    $type: "classic",
    viewsConfig: {
      // Plain editor, no workbench views.
      $type: "EditorService",
    },
    monacoWorkerFactory: configureStandaloneWorkerFactory,
  };

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
      // 'vs-dark' is the builtin classic dark theme. (The VS Code
      // 'Default Dark Modern' theme would require the extension-host
      // theme-defaults extension, which the standalone setup omits.)
      theme: "vs-dark",
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
    onChange?.(textChanges.modified ?? "");
  };

  return (
    <MonacoEditorReactComp
      style={{ minHeight: `${minHeight}px`, height: `${minHeight}px` }}
      vscodeApiConfig={vscodeApiConfig}
      editorAppConfig={editorAppConfig}
      onTextChanged={handleTextChanged}
      onEditorStartDone={() => {
        // Per-editor ready signal for the completion providers. We use this
        // (not onVscodeApiInitDone) because the vscode API initialises globally
        // once, so a second editor never gets its own onVscodeApiInitDone - but
        // onEditorStartDone fires for each editor instance.
        setApiReady(true);
      }}
    />
  );
};
