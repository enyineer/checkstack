// Side-effect import: bundles Monaco's per-language workers via Vite
// `?worker` imports and points `@monaco-editor/react`'s loader at the
// local Monaco rather than its CDN default. Must run before any
// `<Editor>` mount. See monacoWorkers.ts for the full explanation
// (TL;DR: without local workers, the TS service can't spawn `ts.worker`,
// so TypeScript editors silently degrade to no-language-service mode
// while shell editors keep working because they only need the generic
// editor worker).
import "./monacoWorkers";

import React from "react";
import Editor, {
  type OnMount,
  type Monaco,
} from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import { detectOpenTemplate, detectAutoClosedBraces } from "./templateUtils";
import { ensureMonacoStdlib } from "./monacoStdlib";
import {
  matchShellEnvVarTrigger,
  buildShellEnvVarInsertText,
} from "./shellEnvVarMatcher";

// Note on loader config: previously this module called
//   loader.config({ "vs/nls": { availableLanguages: { "*": "en" } } })
// to keep Monaco in English when the loader fetched it from a CDN. We
// now bundle Monaco locally (see monacoWorkers.ts → loader.config({
// monaco })), which short-circuits the AMD loader entirely — the NLS
// config can't apply because no remote Monaco is ever fetched. English
// is the default for the locally bundled `monaco-editor` package, so
// removing the call has no observable effect.

export type CodeEditorLanguage =
  | "json"
  | "yaml"
  | "xml"
  | "markdown"
  | "javascript"
  | "typescript"
  | "shell";

/**
 * A single payload property available for templating
 */
export interface TemplateProperty {
  /** Full path to the property, e.g., "payload.incident.title" */
  path: string;
  /** Type of the property, e.g., "string", "number", "boolean" */
  type: string;
  /** Optional description of the property */
  description?: string;
}

/**
 * A single environment variable available to shell scripts. Surfaced as
 * a Monaco completion item after the user types `$` or `${` in shell mode.
 */
export interface ShellEnvVar {
  /** Variable name without the leading `$`, e.g. `EVENT_ID`. */
  name: string;
  /** Optional description shown in the completion popup. */
  description?: string;
  /** Optional example value shown in the completion item detail. */
  example?: string;
}

export interface CodeEditorProps {
  /** Unique identifier for the editor */
  id?: string;
  /** Current value of the editor */
  value: string;
  /** Callback when the value changes */
  onChange: (value: string) => void;
  /** Language for syntax highlighting */
  language?: CodeEditorLanguage;
  /** Minimum height of the editor */
  minHeight?: string;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Placeholder text when empty */
  placeholder?: string;
  /**
   * TypeScript type definitions to inject for IntelliSense.
   * Generated from JSON schemas for context-aware autocomplete.
   */
  typeDefinitions?: string;
  /**
   * Optional template properties for autocomplete.
   * When provided, typing "{{" triggers autocomplete with available template variables.
   */
  templateProperties?: TemplateProperty[];
  /**
   * Optional environment-variable hints for shell mode. When provided and
   * `language === "shell"`, Monaco autocompletes them after `$` and `${`.
   * Use this to surface platform-injected vars like `EVENT_ID` or
   * `PAYLOAD_*` without forcing users to memorise the names.
   */
  shellEnvVars?: ShellEnvVar[];
}

// Map language names to Monaco language IDs
const languageMap: Record<string, string> = {
  json: "json",
  yaml: "yaml",
  xml: "xml",
  markdown: "markdown",
  javascript: "javascript",
  typescript: "typescript",
  shell: "shell",
};

/**
 * File-extension hint used in the per-editor Monaco model URI. Monaco
 * decides which language service to use partly from the URI's extension,
 * so a path like `<id>.ts` reliably yields the TypeScript service even
 * if the `language` prop is still being reconciled by the React wrapper
 * during a fast tab-switch. This is what fixes the "TS check now has
 * shell highlighting after I created an SSH check" bug: without
 * different paths, every `<CodeEditor>` mount reuses Monaco's _default_
 * model — and the model's previous language sticks around.
 */
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  json: "json",
  yaml: "yaml",
  xml: "xml",
  markdown: "md",
  javascript: "js",
  typescript: "ts",
  shell: "sh",
  "json-template": "json",
};

// Track if we've registered the json-template language
let jsonTemplateLanguageRegistered = false;

/**
 * Default type definitions injected on top of the bundled Node/Bun stdlib.
 *
 * `ensureMonacoStdlib` mounts the real upstream `@types/node` + `bun-types`
 * d.ts files into Monaco's virtual filesystem, so `import { loadavg } from
 * "node:os"`, `fetch`, `console`, `URL`, etc. are all already declared.
 * This block only adds what's _specific_ to the inline-script runner —
 * the `context` global and the expected return shape.
 *
 * Used when no custom typeDefinitions prop is passed.
 */
const DEFAULT_BACKEND_TYPE_DEFINITIONS = `
/** Expected return shape for inline-script health checks. */
interface HealthCheckScriptResult {
  /** Whether the health check passed. */
  success: boolean;
  /** Optional status message — surfaces in the run detail. */
  message?: string;
  /** Optional numeric value — feeds the value chart + anomaly detection. */
  value?: number;
}

/**
 * Runtime context exposed by the inline-script runner.
 * Available as a global, so just reference \`context.config\`.
 */
declare const context: {
  /** The raw collector configuration object. */
  readonly config: Record<string, unknown>;
};
`;

/**
 * A code editor component with syntax highlighting, IntelliSense, and template autocomplete.
 * Uses Monaco Editor (VS Code's editor) for full TypeScript/JavaScript language support.
 */
export const CodeEditor: React.FC<CodeEditorProps> = ({
  id,
  value,
  onChange,
  language = "json",
  minHeight = "100px",
  readOnly = false,
  placeholder,
  typeDefinitions,
  templateProperties,
  shellEnvVars,
}) => {
  const editorRef = React.useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = React.useRef<Monaco | null>(null);
  const disposablesRef = React.useRef<{ dispose: () => void }[]>([]);
  // Track when editor is mounted to re-trigger useEffects
  const [isEditorMounted, setIsEditorMounted] = React.useState(false);

  // Register json-template language BEFORE editor creates the model
  const handleEditorWillMount = (monaco: Monaco) => {
    if (!jsonTemplateLanguageRegistered) {
      monaco.languages.register({ id: "json-template" });
      // Use JSON syntax highlighting
      monaco.languages.setLanguageConfiguration("json-template", {
        comments: {
          lineComment: "//",
          blockComment: ["/*", "*/"],
        },
        brackets: [
          ["{", "}"],
          ["[", "]"],
        ],
        autoClosingPairs: [
          { open: "{", close: "}" },
          { open: "[", close: "]" },
          { open: '"', close: '"' },
        ],
      });
      // Custom tokenizer that highlights {{...}} templates specially
      monaco.languages.setMonarchTokensProvider("json-template", {
        tokenizer: {
          root: [
            [/\{\{[^}]*\}\}/, "variable"], // Template syntax - highlight specially
            [/"([^"\\]|\\.)*$/, "string.invalid"], // Unterminated string
            [/"/, "string", "@string"],
            [/[{}[\]]/, "delimiter.bracket"],
            [/-?\d+\.?\d*([eE][-+]?\d+)?/, "number"],
            [/true|false/, "keyword"],
            [/null/, "keyword"],
            [/[,:]/, "delimiter"],
            [/\s+/, "white"],
          ],
          string: [
            [/[^\\"]+/, "string"],
            [/\\./, "string.escape"],
            [/"/, "string", "@pop"],
          ],
        },
      });
      jsonTemplateLanguageRegistered = true;
    }
  };

  // Handle editor mount
  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setIsEditorMounted(true);



    // Per-editor TS/JS setup. All GLOBAL TS-service config (compiler
    // options, diagnostics options, eager model sync) is done once at
    // module load in monacoWorkers.ts — doing it here, after the
    // service may have already initialised lazily from a previous
    // mount, was the root cause of the "open shell first, TS service
    // is broken" bug.
    //
    // The per-editor `addExtraLib` for THIS editor's `context.d.ts` is
    // handled by the useEffect below (so it can also refresh when the
    // `typeDefinitions` prop changes), keyed by `modelIdRef.current` so
    // two TS editors with different schemas don't share a virtual path.
    //
    // Here we only kick off the lazy stdlib bundle so the ~3 MB chunk
    // starts streaming on the first TS editor mount.
    if (language === "typescript" || language === "javascript") {
      void ensureMonacoStdlib(monaco);
    }

    // Handle validation for template syntax in JSON
    // Since we're using json-template language (no built-in validation),
    // we run our own validation with preprocessed content.
    if (
      templateProperties &&
      templateProperties.length > 0 &&
      language === "json"
    ) {
      const model = editor.getModel();
      if (model) {
        // Custom validation function
        const runCustomValidation = () => {
          const content = model.getValue();

          // Replace {{...}} templates with valid JSON strings of same length
          // Using same length ensures error positions map correctly
          const preprocessed = content.replaceAll(
            /\{\{[^}]*\}\}/g,
            (match) => `"${"_".repeat(Math.max(0, match.length - 2))}"`,
          );

          // Try to parse the preprocessed JSON
          const markers: editor.IMarkerData[] = [];
          try {
            JSON.parse(preprocessed);
          } catch (error) {
            if (error instanceof SyntaxError) {
              // Extract position from error message (varies by browser)
              const message = error.message;
              // Try to find line/column info - JSON.parse errors are at position
              const posMatch = message.match(/position (\d+)/i);

              if (posMatch) {
                const pos = Number.parseInt(posMatch[1], 10);
                const position = model.getPositionAt(pos);
                markers.push({
                  severity: monaco.MarkerSeverity.Error,
                  message: message,
                  startLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column + 1,
                });
              } else {
                // Fallback: put error at start
                markers.push({
                  severity: monaco.MarkerSeverity.Error,
                  message: message,
                  startLineNumber: 1,
                  startColumn: 1,
                  endLineNumber: 1,
                  endColumn: 2,
                });
              }
            }
          }

          monaco.editor.setModelMarkers(model, "json-template", markers);
        };

        // Run validation on content changes
        const contentListener = model.onDidChangeContent(() => {
          runCustomValidation();
        });

        // Run initial validation
        runCustomValidation();

        disposablesRef.current.push(contentListener, {
          dispose: () => {
            // Re-enable Monaco's JSON validation when unmounted
            monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
              validate: true,
            });
          },
        });
      }
    }
  };

  // Track the template provider separately so we can update it
  const templateProviderRef = React.useRef<{ dispose: () => void } | undefined>(
    undefined,
  );

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      for (const d of disposablesRef.current) {
        d.dispose();
      }
      disposablesRef.current = [];
      if (templateProviderRef.current) {
        templateProviderRef.current.dispose();
      }
    };
  }, []);

  // Update template completion provider when templateProperties changes
  React.useEffect(() => {
    if (!monacoRef.current) return;

    if (templateProviderRef.current) {
      templateProviderRef.current.dispose();
    }

    if (!templateProperties || templateProperties.length === 0) return;

    const monaco = monacoRef.current;

    // Compute effective language - same logic as used for Editor
    const hasTemplates = templateProperties && templateProperties.length > 0;
    const providerLanguage =
      hasTemplates && language === "json"
        ? "json-template"
        : (languageMap[language] ?? language);

    const provider = monaco.languages.registerCompletionItemProvider(
      providerLanguage,
      {
        triggerCharacters: ["{"],
        provideCompletionItems: (
          model: editor.ITextModel,
          position: Position,
        ) => {
          // Get full content and cursor offset for utility functions
          const content = model.getValue();
          const cursorOffset = model.getOffsetAt(position);

          // Use tested utility to detect if we're in an open template
          const openTemplate = detectOpenTemplate({ content, cursorOffset });

          if (!openTemplate.isInTemplate) {
            return { suggestions: [] };
          }

          const query = openTemplate.query.toLowerCase();
          const startColumn = openTemplate.startColumn;

          // Check if Monaco auto-closed with }} after cursor using tested utility
          const autoClosedBraces = detectAutoClosedBraces({
            content,
            cursorOffset,
          });
          const endColumn = position.column + autoClosedBraces;

          const suggestions = templateProperties
            .filter(
              (prop) => query === "" || prop.path.toLowerCase().includes(query),
            )
            .map((prop, index) => ({
              label: `{{${prop.path}}}`,
              kind: monaco.languages.CompletionItemKind.Variable,
              detail: prop.type,
              documentation: prop.description,
              insertText: `{{${prop.path}}}`,
              // Use sortText starting with space to appear before other completions
              sortText: ` ${String(index).padStart(4, "0")}`,
              // Use the query as filterText so it matches what user typed
              filterText: `{{${query}${prop.path}`,
              preselect: index === 0, // Preselect first item
              range: {
                startLineNumber: position.lineNumber,
                startColumn: startColumn,
                endLineNumber: position.lineNumber,
                endColumn: endColumn,
              },
            }));

          return { suggestions, incomplete: false };
        },
      },
    );

    templateProviderRef.current = provider;

    return () => {
      provider.dispose();
    };
  }, [templateProperties, language, isEditorMounted]);

  // Install (and refresh) the per-editor context.d.ts.
  //
  // - Includes `isEditorMounted` in the deps so the effect runs after
  //   `monacoRef.current` is wired up by `handleEditorDidMount`.
  // - Uses a unique virtual path keyed by this editor instance
  //   (`context-<modelId>.d.ts`) so two TS editors with different
  //   collector schemas can't overwrite each other's context types.
  // - Returns a cleanup that disposes the registered lib, both on
  //   unmount and when `typeDefinitions` / `language` change.
  React.useEffect(() => {
    if (!isEditorMounted) return;
    if (!monacoRef.current) return;
    if (language !== "typescript" && language !== "javascript") return;

    const monaco = monacoRef.current;
    const defaults =
      language === "typescript"
        ? monaco.typescript.typescriptDefaults
        : monaco.typescript.javascriptDefaults;

    const definitions = typeDefinitions ?? DEFAULT_BACKEND_TYPE_DEFINITIONS;
    const contextLibPath = `file:///context-${modelIdRef.current}.d.ts`;
    const lib = defaults.addExtraLib(definitions, contextLibPath);

    return () => {
      lib.dispose();
    };
  }, [typeDefinitions, language, isEditorMounted]);

  // Shell env-var completion. When the caller passes `shellEnvVars`, we
  // register a Monaco provider that suggests variable names after the
  // user types `$` or `${` — and also brace-closes `${name}` correctly.
  // Re-registers when the var list or language changes.
  React.useEffect(() => {
    if (!isEditorMounted) return;
    if (!monacoRef.current) return;
    if (language !== "shell") return;
    if (!shellEnvVars || shellEnvVars.length === 0) return;

    const monaco = monacoRef.current;
    const provider = monaco.languages.registerCompletionItemProvider("shell", {
      triggerCharacters: ["$", "{"],
      provideCompletionItems: (model: editor.ITextModel, position: Position) => {
        const lineText = model.getLineContent(position.lineNumber);
        const textBefore = lineText.slice(0, position.column - 1);
        const match = matchShellEnvVarTrigger(textBefore);
        if (!match) return { suggestions: [] };

        const startColumn = position.column - match.prefixLength;

        const suggestions = shellEnvVars
          .filter(
            (v) =>
              match.query === "" ||
              v.name.toUpperCase().includes(match.query),
          )
          .map((v, index) => ({
            label: `$${v.name}`,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: v.example ? `e.g. ${v.example}` : "shell env var",
            documentation: v.description,
            insertText: buildShellEnvVarInsertText(match, v.name),
            sortText: ` ${String(index).padStart(4, "0")}`,
            filterText: `$${v.name}`,
            range: {
              startLineNumber: position.lineNumber,
              startColumn,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
          }));

        return { suggestions, incomplete: false };
      },
    });

    return () => {
      provider.dispose();
    };
  }, [shellEnvVars, language, isEditorMounted]);

  // Calculate height from minHeight
  const heightValue = minHeight.replace("px", "");
  const numericHeight = Number.parseInt(heightValue, 10) || 100;

  // Compute effective language - use json-template when we have templates for JSON
  const hasTemplates = templateProperties && templateProperties.length > 0;
  const effectiveLanguage =
    hasTemplates && language === "json"
      ? "json-template"
      : (languageMap[language] ?? language);

  // Stable, unique-per-instance model path. We need this for two reasons:
  //
  //  1. Without a `path`, all `@monaco-editor/react` instances share the
  //     single default in-memory model. When you switch between a TS
  //     inline-script check and an SSH (shell) check, the new mount
  //     inherits the previous model's language, producing visibly wrong
  //     syntax highlighting until something else triggers a refresh.
  //
  //  2. The extension portion (`.ts`, `.sh`, `.json`, ...) is one of the
  //     signals Monaco's language service uses to decide which tokenizer
  //     and worker to apply, so encoding the effective language in the
  //     path makes the language choice unambiguous.
  //
  // We deliberately use a fresh UUID per mount (in a `useRef`, lazy
  // init) rather than `useId`: `useId`'s output is derived from the
  // call-site's position in the React tree, so a remount of the same
  // `<CodeEditor>` slot — typical when the user switches between two
  // healthcheck pages that React Router reuses — can return the same
  // id as before. `@monaco-editor/react` then reuses the previous
  // model (and its language) from Monaco's registry, which is exactly
  // the "TS check now has shell highlighting" bug.
  const modelIdRef = React.useRef<string | null>(null);
  if (modelIdRef.current === null) {
    modelIdRef.current = `cs-editor-${
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 11)
    }`;
  }
  const pathExtension =
    LANGUAGE_EXTENSIONS[effectiveLanguage] ?? effectiveLanguage;
  const modelPath = `${modelIdRef.current}.${pathExtension}`;

  return (
    <div
      id={id}
      className="w-full rounded-md border border-input bg-background font-mono text-sm focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all box-border overflow-visible"
      style={{ minHeight }}
    >
      <Editor
        height={`${Math.max(numericHeight, 100)}px`}
        language={effectiveLanguage}
        path={modelPath}
        value={value}
        onChange={(newValue) => onChange(newValue ?? "")}
        beforeMount={handleEditorWillMount}
        onMount={handleEditorDidMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          lineNumbers: "on",
          lineNumbersMinChars: 3,
          folding: false,
          wordWrap: "on",
          scrollBeyondLastLine: false,
          fontSize: 14,
          fontFamily: "ui-monospace, monospace",
          tabSize: 2,
          automaticLayout: true,
          scrollbar: {
            vertical: "auto",
            horizontal: "auto",
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          overviewRulerBorder: false,
          renderLineHighlight: "none",
          contextmenu: false,
          // Placeholder support via aria-label
          ariaLabel: placeholder ?? "Code editor",
        }}
        theme="vs-dark"
        loading={
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Loading editor...
          </div>
        }
      />
    </div>
  );
};
