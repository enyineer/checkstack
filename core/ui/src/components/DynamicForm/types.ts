import type React from "react";
import type {
  TemplateProperty,
  ShellEnvVar,
  AcquireTypes,
  AcquiredTypeFile,
} from "../CodeEditor";
import type { TemplateCompletionProvider } from "../TemplateValueInput";
import type { EditorType } from "@checkstack/common";

// Re-export types used by multi-type editor
export type { EditorType } from "./utils";
// Re-export `ShellEnvVar` so DynamicForm consumers don't have to import
// from two paths. The canonical definition lives in `../CodeEditor`.
export type { ShellEnvVar } from "../CodeEditor";
import type {
  JsonSchemaPropertyCore,
  JsonSchemaBase,
} from "@checkstack/common";
import type { FieldErrorMap } from "./validation.logic";

/**
 * JSON Schema property with DynamicForm-specific x-* extensions for config rendering.
 * Uses the generic core type for proper recursive typing.
 */
export interface JsonSchemaProperty extends JsonSchemaPropertyCore<JsonSchemaProperty> {
  // Config-specific x-* extensions
  "x-secret"?: boolean; // Field contains sensitive data
  "x-color"?: boolean; // Field is a color picker
  "x-options-resolver"?: string; // Name of resolver function for dynamic options
  "x-options-style"?: "select" | "catalog"; // How resolved options render: a compact Select (default) or a browsable catalog modal showing each option's description
  "x-depends-on"?: string[]; // Field names this field depends on (triggers refetch)
  "x-hidden"?: boolean; // Field should be hidden in form (auto-populated)
  "x-searchable"?: boolean; // Shows search input for filtering dropdown options
  "x-editor-types"?: EditorType[]; // Available editor types for multi-type input
  "x-hidden-when"?: Record<string, string[]>; // Conditionally hide based on sibling field values
  "x-duration"?: boolean; // Render a DurationInput (single-unit duration object)
  "x-script-testable"?: boolean; // Field is an inline script that can be tested in-UI
  "x-secret-env"?: boolean; // Record field is a secret -> env mapping (SecretEnvEditor)
  "x-templatable"?: boolean; // String value is rendered through the template engine at run time
}

/**
 * Sample context used to preview the rendered output of `x-templatable`
 * string fields in the editor (e.g. `{ environment: { baseUrl: "..." } }`).
 * When supplied to DynamicForm, a "Preview" line appears below each
 * templatable field showing `renderTemplatePreview(value, context)` so authors
 * see the resolved value while editing. Shares the run-time render semantics
 * (see `@checkstack/template-engine`), so the preview never diverges.
 */
export type TemplatePreviewContext = Record<string, unknown>;

/**
 * Renders the inline script-test UI beneath a testable script field. The
 * owning feature page supplies this; it owns the RPC call + sample-context
 * state and typically renders a `ScriptTestPanel`. The form only decides
 * *where* it appears (below any `x-script-testable` field whose selected
 * editor type is a code language). Mirrors the callback-prop pattern used
 * by `optionsResolvers` / `templateCompletionProvider`.
 */
export type ScriptTestRenderer = (args: {
  /** The field's id (form key). */
  fieldId: string;
  /** Editor language currently selected in the field. */
  kind: "typescript" | "shell";
  /** Current script source in the field. */
  script: string;
  /**
   * The current value of the SIBLING secret→env mapping field (the field
   * annotated `x-secret-env` within the same config object as the script),
   * if any. DynamicForm locates it by the annotation — not by name — so the
   * test panel can inject `__SECRET_<NAME>__` placeholders (or the operator's
   * overrides) for the same secrets the real action declares. `undefined`
   * when the config has no `x-secret-env` field or it's empty.
   */
  secretEnv?: Record<string, string>;
}) => React.ReactNode;

/** Option returned by an options resolver */
export interface ResolverOption {
  value: string;
  label: string;
  /**
   * Optional longer description. Shown in the `catalog` options style (a
   * browsable modal of cards) so the operator can tell options apart by more
   * than their label. Ignored by the default `select` style.
   */
  description?: string;
}

/** Function that resolves dynamic options, receives form values as context */
export type OptionsResolver = (
  formValues: Record<string, unknown>,
) => Promise<ResolverOption[]>;

/**
 * JSON Schema for config forms with DynamicForm-specific extensions.
 */
export type JsonSchema = JsonSchemaBase<JsonSchemaProperty>;

/**
 * Default starter templates per editor language. Used to populate empty
 * multi-type editor fields so users see a working example instead of a
 * blank canvas. Keyed by `EditorType` (e.g. "typescript", "shell").
 */
export type EditorStarterTemplates = Partial<Record<EditorType, string>>;

export interface DynamicFormProps {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  /**
   * Optional callback when form validity changes.
   * Reports true if all required fields are filled.
   */
  onValidChange?: (isValid: boolean) => void;
  /**
   * Optional map of resolver names to functions that fetch dynamic options.
   * Referenced by x-options-resolver in schema properties.
   */
  optionsResolvers?: Record<string, OptionsResolver>;
  /**
   * Optional list of available template properties for multi-type editor fields.
   * When provided, fields with x-editor-types get {{ autocomplete suggestions.
   */
  templateProperties?: TemplateProperty[];
  /**
   * Optional staged, context-aware completion provider for plain
   * single-line string fields. When supplied, default string inputs
   * render a {@link TemplateValueInput} wired to this provider instead
   * of a bare `Input`, so `{{ … }}` expressions get field / comparator /
   * value / filter autocomplete (the automation editor passes the
   * template-mode provider here). Omit it and string fields stay plain.
   */
  templateCompletionProvider?: TemplateCompletionProvider;
  /**
   * Optional TypeScript declarations to inject into Monaco for `typescript`
   * or `javascript` editor-type fields. Typically built from a schema via
   * `generateTypeDefinitions()` so users get autocomplete + type errors
   * against the runtime context they'll see.
   */
  typeDefinitions?: string;
  /**
   * Optional list of environment-variable names that are available to
   * `shell` editor-type fields. When provided, Monaco autocompletes them
   * after `$` and `${`. Use this to surface platform-injected vars like
   * `EVENT_ID`, `PAYLOAD_*` etc. so users don't have to remember the names.
   */
  shellEnvVars?: ShellEnvVar[];
  /**
   * Optional initial content per editor language, used to populate empty
   * fields with a working example. Keyed by `EditorType`.
   */
  starterTemplates?: EditorStarterTemplates;
  /**
   * Optional renderer for the inline script-test panel. When supplied,
   * fields flagged `x-script-testable` (whose selected editor type is a
   * code language) render this beneath the editor so operators can run
   * the script against a sample context. Omit it and no test UI appears.
   */
  scriptTestRenderer?: ScriptTestRenderer;
  /**
   * Optional list of secret NAMES (never values) for `x-secret-env` record
   * fields. The owning page fetches these from the secrets plugin's
   * `listSecretNames` and passes them here so the secret-env editor offers
   * name autocomplete. Omit it and the editor still works as free text.
   */
  secretNames?: string[];
  /**
   * Optional lazy type-acquisition resolver forwarded to TS/JS editor-type
   * fields. When supplied, the editor fetches + registers the `.d.ts` of any
   * npm package the script imports, so `import { x } from "pkg"`
   * autocompletes. Injected by the owning page (see
   * `@checkstack/script-packages-frontend`).
   */
  acquireTypes?: AcquireTypes;
  /** Install identity (lockfile hash); resets acquired types on a new install. */
  acquireResetKey?: string;
  /**
   * The running release's `@checkstack/sdk` editor bundle, forwarded to TS/JS
   * editors so `import { defineHealthCheck } from "@checkstack/sdk/healthcheck"`
   * resolves with real, version-matched types.
   */
  sdkTypes?: ReadonlyArray<AcquiredTypeFile>;
  /** Release version; resets the mounted SDK libs on a deployment upgrade. */
  sdkTypesResetKey?: string;
  /**
   * Importable installed package names (already `@types/*`-free), forwarded to
   * TS/JS editors so the import specifier itself autocompletes
   * (`import {} from "lod"` -> `lodash`).
   */
  importablePackages?: string[];
  /**
   * Optional sample context for previewing `x-templatable` fields. When
   * supplied, a "Preview" line appears below each templatable string field
   * showing the rendered output against this context (e.g. a sample
   * environment's custom fields). Omit it and templatable fields render
   * normally with no preview.
   */
  templatePreviewContext?: TemplatePreviewContext;
  /**
   * Opt-in. When `true`, the form shows inline per-field validation messages
   * (for empty required fields) REACTIVELY once a field has been touched and
   * blurred, so the user can see WHY the submit button is disabled without
   * the form nagging while they are still typing. Defaults to `false`, so
   * every existing consumer is visually unchanged unless it opts in.
   */
  showInlineErrors?: boolean;
  /**
   * Optional externally-supplied per-field error messages, keyed by field
   * path (dot-joined for nested object fields, e.g. `spendCap.tokenBudget`).
   * Use this to surface SERVER validation failures inline on the offending
   * field. These render whenever present, independent of the touched-state
   * gate. Omit it (the default) and no external errors show.
   */
  fieldErrors?: FieldErrorMap;
  /**
   * Optional list of `x-secret` field keys whose value is already stored
   * server-side (EDIT mode). A blank input on such a field means "keep the
   * existing secret" and is therefore VALID, not missing-required - the
   * redacted preview never returns the value, so the input is expected to be
   * empty. CREATE mode omits this (or passes `[]`) so blank required secrets
   * stay invalid. Drives both the validity boolean and the inline errors.
   */
  keepExistingSecretFields?: string[];
}

/** Props for the FormField component */
export interface FormFieldProps {
  id: string;
  label: string;
  propSchema: JsonSchemaProperty;
  value: unknown;
  isRequired?: boolean;
  formValues: Record<string, unknown>;
  optionsResolvers?: Record<string, OptionsResolver>;
  templateProperties?: TemplateProperty[];
  templateCompletionProvider?: TemplateCompletionProvider;
  typeDefinitions?: string;
  shellEnvVars?: ShellEnvVar[];
  starterTemplates?: EditorStarterTemplates;
  scriptTestRenderer?: ScriptTestRenderer;
  secretNames?: string[];
  acquireTypes?: AcquireTypes;
  acquireResetKey?: string;
  sdkTypes?: ReadonlyArray<AcquiredTypeFile>;
  sdkTypesResetKey?: string;
  importablePackages?: string[];
  /** Sample context for previewing `x-templatable` fields. */
  templatePreviewContext?: TemplatePreviewContext;
  /**
   * Current value of the sibling `x-secret-env` mapping field within the
   * SAME config object as this field, located by annotation. Threaded down
   * so a testable script field can forward it to {@link ScriptTestRenderer}.
   */
  siblingSecretEnv?: Record<string, string>;
  /**
   * Whether this field currently has an inline validation error. When true the
   * top-level Label/Input render their invalid affordance (`aria-invalid` +
   * destructive styling). Additive; defaults to no error.
   */
  invalid?: boolean;
  /**
   * DOM id of the inline error node (rendered by the parent form), wired to the
   * field control's `aria-describedby` so assistive tech links field -> error.
   */
  errorId?: string;
  /**
   * EDIT mode: this `x-secret` field already has a value stored server-side
   * (its redacted preview arrives blank). When true, the secret input shows a
   * "keep existing" affordance so the empty field reads as intentional rather
   * than lost. Defaults to false (create mode / non-secret fields).
   */
  storedSecret?: boolean;
  /**
   * When true (an OPTIONAL stored secret), the secret input offers a "Clear"
   * affordance that emits {@link SECRET_CLEAR_SENTINEL} so the backend removes
   * the stored value instead of keeping it. Defaults to false.
   */
  clearableSecret?: boolean;
  /** Callback when value changes. Omit val to clear the field. */
  onChange: (val?: unknown) => void;
}


/** Props for the DynamicOptionsField component */
export interface DynamicOptionsFieldProps {
  id: string;
  label: string;
  description?: string;
  value: unknown;
  isRequired?: boolean;
  resolverName: string;
  dependsOn?: string[];
  searchable?: boolean;
  /** Render style: compact `select` (default) or a browsable `catalog` modal. */
  optionsStyle?: "select" | "catalog";
  formValues: Record<string, unknown>;
  optionsResolvers: Record<string, OptionsResolver>;
  /** Callback when value changes. Omit val to clear the field. */
  onChange: (val?: unknown) => void;
}

/** Props for the JsonField component */
export interface JsonFieldProps {
  id: string;
  value: Record<string, unknown>;
  propSchema: JsonSchemaProperty;
  onChange: (val: Record<string, unknown>) => void;
}
