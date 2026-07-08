---
title: "Sending Configuration Schemas to Frontend"
description: "This guide documents the required pattern for exposing plugin configuration schemas to the frontend to enable dynamic form rendering with proper secret field handling."
---

This guide documents the required pattern for exposing plugin configuration schemas to the frontend to enable dynamic form rendering with proper secret field handling.

## Overview

When building admin UIs for plugins, configuration schemas must be converted to JSON Schema format and sent to the frontend. The **critical requirement** is to use the custom `toJsonSchema()` utility from `@checkstack/backend-api` instead of Zod's native `toJSONSchema()` method.

## The Problem

The `DynamicForm` component in `@checkstack/ui` automatically renders password input fields (with show/hide toggles) for fields marked as secrets. However, it relies on the `x-secret` metadata in the JSON Schema to identify these fields.

**Zod's native method does NOT add this metadata:**
```typescript
// ❌ WRONG: Missing x-secret metadata
import { z } from "zod";
const jsonSchema = mySchema.toJSONSchema();
// Result: Secret fields render as regular text inputs
```

## The Solution

Use the custom `toJsonSchema()` function from `@checkstack/backend-api`:

```typescript
// ✅ CORRECT: Adds x-secret metadata
import { toJsonSchema } from "@checkstack/backend-api";
const jsonSchema = toJsonSchema(mySchema);
// Result: Secret fields render as password inputs with show/hide toggle
```

## Complete Implementation Pattern

### 1. Backend Router

When exposing plugin/strategy metadata to the frontend:

```typescript
import { implement } from "@orpc/server";
import { autoAuthMiddleware, type RpcContext, toJsonSchema } from "@checkstack/backend-api";
import { myPluginContract } from "@checkstack/myplugin-common";

// Contract-based implementation with auto auth enforcement
const os = implement(myPluginContract)
  .$context<RpcContext>()
  .use(autoAuthMiddleware);

export const createMyPluginRouter = () => {
  return os.router({
    // Auth and access rules auto-enforced from contract meta
    getPlugins: os.getPlugins.handler(async ({ context }) => {
      const plugins = context.myPluginRegistry.getPlugins().map((p) => ({
        id: p.id,
        displayName: p.displayName,
        description: p.description,
        configVersion: p.configVersion,
        configSchema: toJsonSchema(p.configSchema),  // ✅ Use custom function
      }));
      return plugins;
    }),
  });
};
```

### 2. Plugin/Strategy Schema Definition

Use factory functions for fields that need specialized handling:

```typescript
import { configString, configNumber, configBoolean } from "@checkstack/backend-api";
import { z } from "zod";

const configSchema = z.object({
  host: configString({}).default("localhost").describe("API host"),
  port: configNumber({}).default(443).describe("API port"),
  apiKey: configString({ "x-secret": true }).describe("API authentication key"),  // Marked as secret
  username: configString({}).optional().describe("Username"),
  password: configString({ "x-secret": true }).optional().describe("Password"),   // Marked as secret
});
```

### 3. Frontend Consumption

The frontend automatically handles the password fields:

```typescript
import { PluginConfigForm } from "@checkstack/ui";

// The configSchema from the backend already has x-secret metadata
<PluginConfigForm
  plugins={plugins}  // Contains schemas with x-secret metadata
  selectedPluginId={selectedPluginId}
  config={config}
  onConfigChange={setConfig}
/>
```

## How It Works

### Backend: Schema Conversion Process

The `toJsonSchema()` function in [`schema-utils.ts`](/core/backend-api/src/schema-utils.ts):

1. Calls Zod's native `toJSONSchema()` to get the base JSON Schema
2. Traverses the Zod schema to identify fields created with branded types (`secret()`, `color()`)
3. Adds `x-secret: true` or `x-color: true` metadata to those fields
4. Returns the enhanced JSON Schema

```typescript
// Simplified implementation
function toJsonSchema(zodSchema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = zodSchema.toJSONSchema();
  addSchemaMetadata(zodSchema, jsonSchema);  // Adds x-secret, x-color
  return jsonSchema;
}
```

### Frontend: Specialized Field Rendering

The `DynamicForm` component in [`DynamicForm.tsx`](/core/ui/src/components/DynamicForm.tsx) detects branded fields:

```typescript
// Detect secret fields from x-secret metadata
const isSecret = propSchema["x-secret"];
if (isSecret) {
  // Render password input with show/hide toggle
  return <Input type={showPassword ? "text" : "password"} ... />;
}

// Detect color fields from x-color metadata
const isColor = propSchema["x-color"];
if (isColor) {
  // Render color picker with swatch and text input
  return <ColorPicker value={value} onChange={onChange} />;
}
```

## Factory Functions Reference

The platform provides factory functions for creating Zod schemas with specialized metadata:

### `configString({ "x-secret": true })` - Sensitive Data

Use for passwords, API keys, tokens, and other sensitive data:

```typescript
import { configString } from "@checkstack/backend-api";

const schema = z.object({
  apiKey: configString({ "x-secret": true }).describe("API authentication key"),
  password: configString({ "x-secret": true }).optional().describe("Optional password"),
});
```

**Features:**
- Renders as password input with show/hide toggle
- Values are encrypted at rest via `ConfigService`
- Redacted when returning config to frontend

### `configString({ "x-templatable": true })` - Templatable Fields

Use for string fields whose value is rendered through the template engine at execute time, so authors can reference per-run values like an environment's custom fields:

```typescript
import { configString } from "@checkstack/backend-api";

const schema = z.object({
  // Rendered against { environment, check, system } per run, e.g.
  // "{{ environment.baseUrl }}/healthz". Validation that inspects the
  // concrete value (such as `.url()`) must run POST-render.
  url: configString({ "x-templatable": true }).describe(
    "Full URL. Supports {{ environment.baseUrl }} etc.",
  ),
});
```

**Features:**

- Rendered per environment by the shared `renderTemplatableConfig` pass in the executor, **after** the secret pass and **before** the collector runs. Only `x-templatable` fields are rendered; everything else is passed through verbatim.
- References `{{ environment.<key> }}`, `{{ check.* }}`, `{{ system.* }}`. Missing paths render to an empty string (`strict: false`).
- The config editor shows a live **Preview** line beneath the field (pass `templatePreviewContext` to `DynamicForm`). The preview uses `renderTemplatePreview` from `@checkstack/template-engine`, the same logic the executor uses, so the preview never diverges. The health-check editor builds that context from an author-picked environment via the reusable `EnvironmentPreviewPicker` from `@checkstack/catalog-frontend`, and offers it on BOTH the strategy (connection) form and each collector form; the picker is shown only when a config schema actually has an `x-templatable` field.
- A single-line templatable string field shows a small **Templating** badge next to its label (a discoverability affordance, independent of `.describe()` prose), and - when a `templateCompletionProvider` is supplied - renders a `TemplateValueInput` with `{{ … }}` autocomplete. The health-check editor seeds that provider with the fixed `environment.* / check.* / system.*` namespace via `createReferenceCompletionProvider` from `@checkstack/ui`, and passes `templatableFieldsOnly` so ONLY `x-templatable` fields become template inputs (the automation editor omits that flag, so every string field templates).
- **Must not** be combined with `x-secret` / `x-secret-env` on the same field. Secrets and templating are resolved in separate ordered passes (secrets first), and `assertNoSecretTemplatableConflict` rejects a both-marked field when the plugin loads.

> [!IMPORTANT]
> Because a templatable field's stored value can contain `{{ }}`, schema validation that inspects the concrete value (e.g. `z.string().url()`, `.min(1)`) cannot run at store time. Store the field as a plain `configString`, then re-validate the **rendered** value where it is consumed: a collector re-validates in `execute()` and returns a `CollectorResult` with a populated `error` (the HTTP collector re-parses its rendered `url` and returns "Rendered URL is invalid"); a strategy re-validates its rendered connection fields (host, database, user, base URL) in `createClient()` and THROWS on an empty / invalid render. Both map to a transport failure, so an empty render never reads as healthy. Optional fields (SNI, DNS nameserver) are marked templatable but left un-guarded, since an empty render is a legitimate "unset".

### `configString({ "x-color": true })` - Hex Colors

Use for hex color values (e.g., brand colors, theme colors):

```typescript
import { configString } from "@checkstack/backend-api";

const schema = z.object({
  // With default value
  primaryColor: configString({ "x-color": true }).default("#3b82f6").describe("Primary brand color"),
  // Optional without default
  accentColor: configString({ "x-color": true }).optional().describe("Accent color"),
});
```

**Features:**
- Renders as color picker with swatch + text input
- Validates hex format (`#RGB` or `#RRGGBB`)
- Supports optional default values

### `configString({ "x-options-resolver": ... })` - Dynamic Dropdowns

Use for fields that need to fetch options dynamically from the backend:

```typescript
import { configString } from "@checkstack/backend-api";

const schema = z.object({
  // Basic options resolver
  projectKey: configString({
    "x-options-resolver": "projectOptions",
  }).describe("Jira project"),
  
  // With dependencies (refetches when dependent fields change)
  issueTypeId: configString({
    "x-options-resolver": "issueTypeOptions",
    "x-depends-on": ["projectKey"],
  }).describe("Issue type"),
  
  // With searchable dropdown for many options
  fieldKey: configString({
    "x-options-resolver": "fieldOptions",
    "x-depends-on": ["projectKey", "issueTypeId"],
    "x-searchable": true,
  }).describe("Jira field"),
});
```

**Features:**
- Renders as a dropdown that fetches options from backend
- `x-options-resolver`: Name of the resolver function to call
- `x-depends-on`: Array of field names that trigger refetch when changed
- `x-searchable`: When true, renders a searchable dropdown with filter input inside

**Implementation requirements:**
The provider must implement `getConnectionOptions()` to handle resolver calls. See [Integration Providers](/checkstack/developer-guide/backend/integrations/providers/#connection-based-providers-with-dynamic-options) for details.

### `configString({ "x-hidden": true })` - Auto-populated Fields

Use for fields that are auto-populated and should not be shown in the form:

```typescript
import { configString } from "@checkstack/backend-api";

const schema = z.object({
  // Hidden field (auto-populated)
  connectionId: configString({ "x-hidden": true }).describe("Connection ID (auto-populated)"),
  
  // Normal visible fields
  name: configString({}).describe("Subscription name"),
});
```

**Features:**
- Field is hidden from the form UI
- Value is typically set programmatically
- Useful for connection IDs or other auto-populated values

### `configString({ "x-editor-types": [...] })` - Multi-Type Editor

Use for string fields that support multiple input formats with dynamic editing modes:

```typescript
import { configString } from "@checkstack/backend-api";

const schema = z.object({
  // HTTP request body with multiple format options
  body: configString({
    "x-editor-types": ["none", "raw", "json", "yaml", "xml", "formdata"],
  }).optional().describe("Request body"),

  // Template field with structured data support
  template: configString({
    "x-editor-types": ["json", "yaml", "xml"],
  }).describe("Template content"),

  // Simple template with just raw text
  bodyTemplate: configString({
    "x-editor-types": ["raw"],
  }).optional().describe("Custom body template"),

  // Documentation with markdown support
  notes: configString({
    "x-editor-types": ["raw", "markdown"],
  }).optional().describe("Notes or documentation"),
});
```

**Available Editor Types:**

Text / markup editors (template-able):
- `"none"`: Disabled input (value is cleared/undefined)
- `"raw"`: Plain text textarea
- `"json"`: JSON code editor with syntax highlighting and auto-indentation
- `"yaml"`: YAML code editor with syntax highlighting and auto-indentation
- `"xml"`: XML/HTML code editor with tag highlighting
- `"markdown"`: Markdown editor with syntax highlighting
- `"formdata"`: Key-value pair editor (URL-encoded format)

Native-code editors (NOT template-able):
- `"typescript"` / `"javascript"`: code editor with full TypeScript type-checking
- `"shell"`: shell code editor with `$env` autocomplete

**Common features:**
- Dropdown selector when multiple types are available
- Auto-detects initial editor type from existing value
- Automatic format conversion when switching between types
- All formats serialize to a single string for storage

### How a field accesses run context

There is exactly **one** context-access mechanism per field kind. They
never overlap, because {% raw %}`{{ }}`{% endraw %} template text is not
valid TypeScript and Monaco can't type it:

| Field kind | Mechanism | Driven by |
| --- | --- | --- |
| Plain single-line string | {% raw %}`{{ … }}`{% endraw %} templates | `templateCompletionProvider` |
| Text / markup editor (`raw`, `json`, `yaml`, `xml`, `markdown`, `formdata`) | {% raw %}`{{ … }}`{% endraw %} templates | `templateProperties` |
| `typescript` / `javascript` editor | a typed `context` object | `typeDefinitions` |
| `shell` editor | `$`-prefixed env vars | `shellEnvVars` |

> [!IMPORTANT]
> Code editors (`typescript` / `javascript` / `shell`) deliberately do
> **not** offer {% raw %}`{{ }}`{% endraw %} autocomplete and their
> {% raw %}`{{ }}`{% endraw %} markers are left un-rendered at run time.
> Use the native mechanism instead: a `context` object for TS/JS, `$ENV`
> vars for shell. This keeps a single, unambiguous way to read context in
> each editor.

### `configString({ "x-script-testable": true })` - Inline script testing

Mark a code field (one whose `x-editor-types` includes `typescript`,
`javascript`, or `shell`) as testable. When the owning page passes a
`scriptTestRenderer` to `DynamicForm`, a `ScriptTestPanel` appears beneath
the editor so operators can run the script against an editable sample
context and see the return value, stdout, stderr, exit code, and duration
without dispatching a whole automation.

```typescript
import { configString } from "@checkstack/backend-api";

const schema = z.object({
  // A testable TypeScript action script
  script: configString({
    "x-editor-types": ["typescript"],
    "x-script-testable": true,
  }).describe("Default-export a function that receives `context`."),
});
```

The flag only governs *where* the panel renders; the panel itself is
inert until the page supplies the renderer. Wire it like the automation
action editor does:

```tsx
import { automationScriptTestRenderer } from "./editor/ScriptTestRenderer";

<DynamicForm
  schema={configSchema}
  value={formValue}
  onChange={setFormValue}
  typeDefinitions={typeDefinitions}
  shellEnvVars={shellEnvVars}
  scriptTestRenderer={automationScriptTestRenderer}
/>
```

The renderer owns the RPC call (`testScript`) and the sample-context
state; `@checkstack/ui` stays plugin-agnostic. Tests run on the central
backend with the same subprocess isolation and `SAFE_ENV_VARS` env as the
real action, so packages cannot read backend secrets. Real satellite runs
may differ; the panel notes this.

**Health-check collectors** use the same machinery: the inline-script
(TypeScript) and shell `script` collector fields are `x-script-testable`,
and the collector editor passes a renderer wired to `testCollectorScript`.
The collector test context is `{ config, check?, system? }`, auto-seeded
from the live collector config plus placeholder check / system metadata.

**Load from run (replay).** The `ContextSampleEditor` accepts an optional
`runPicker` slot. The automation editor fills it with a "Load from run"
dropdown that calls `getRunScopeForReplay` to seed the sample context from
a real run (trigger + persisted artifacts, plus variables / loop state
when the run's durable scope snapshot is still present). Health-check
executions do **not** persist the script / config / check / system that
produced a result, so there is no health-check replay - auto-seed is the
only context source for collector tests.

**Template autocomplete (text/markup fields).** When the parent
`DynamicForm` receives `templateProperties`, the text/markup editor types
show suggestions when typing {% raw %}`{{`{% endraw %}:

```tsx
<DynamicForm
  schema={configSchema}
  value={formValue}
  onChange={setFormValue}
  templateProperties={[
    { path: "payload.incident.title", type: "string" },
    { path: "payload.incident.severity", type: "string" },
  ]}
/>
```

**Staged completion (plain single-line string fields).** Single-line
string fields render a bare input by default. Pass a
`templateCompletionProvider` to render them as a `TemplateValueInput`
with staged field / comparator / value / filter completion inside
{% raw %}`{{ … }}`{% endraw %} blocks (the automation editor uses this for
fields like a log action's `message`). The prop is opt-in, so other
consumers are unaffected.

#### Template namespaces and reference syntax

Inside {% raw %}`{{ … }}`{% endraw %} blocks the top-level namespaces are
**plural**: `artifacts`, `variables`, plus `trigger`, `repeat`, and
`now`. The autocomplete (`{% raw %}{{{% endraw %}` typeahead) and the `fx`
variable picker insert the runtime-parseable form for you, so you rarely
hand-write these, but the rules matter when editing existing templates:

- **Variables** use `variables.<name>`. If the name is not a plain
  identifier, switch to bracket notation:

  ```text
  {% raw %}{{ variables.myVar }}{% endraw %}
  {% raw %}{{ variables["weird-name"] }}{% endraw %}
  ```

- **Artifacts** are referenced by the producing action's `id`, then by the
  artifact's local name:
  {% raw %}`{{ artifacts.<actionId>.<artifactName>.<field> }}`{% endraw %}.
  For example, an action with `id: open_jira` that produces the
  `integration-jira.issue` artifact (local name `issue`) is referenced as:

  ```text
  {% raw %}{{ artifacts.open_jira.issue.issueKey }}{% endraw %}
  ```

  Action ids are identifiers (letters, digits, underscore - no dots or
  hyphens), so the path is plain dot notation; no bracket notation is
  needed. Referencing by action id - not by artifact type - is what lets
  two actions of the same type (e.g. two "create Jira issue" steps) be
  addressed independently.

- **Array values** can be referenced whole or indexed by a numeric
  index. Arrays of arrays work too:

  ```text
  {% raw %}{{ artifacts.open_jira.issue.tags }}{% endraw %}
  {% raw %}{{ artifacts.open_jira.issue.tags[0] }}{% endraw %}
  {% raw %}{{ artifacts.open_jira.issue.comments[0].author }}{% endraw %}
  ```

> [!IMPORTANT]
> These {% raw %}`{{ }}`{% endraw %} namespaces apply only to text/markup
> fields. They share the same keying as the typed `context` object used by
> TS/JS script actions (`context.artifacts.open_jira.issue`,
> `context.var`, ...) and the `$CHECKSTACK_*` env vars used by shell
> actions. See the next two sections for those.

**Typed context (TS/JS editors).** Pass `typeDefinitions` (a
`declare const context: …` string) and the editor types the `context` global.
The automation editor builds this per-automation via
`generateAutomationContextTypes`, so `context.trigger.payload` is the
discriminated union over the automation's subscribed triggers, with
`context.artifacts.<actionId>.<artifactName>` / `context.var` /
`context.repeat` in scope.

**Env vars (shell editor).** Pass `shellEnvVars` (a `{ name, description }[]`)
and the shell editor autocompletes them after `$`. The automation editor
derives these from the run scope with the shared `toShellEnvKey` rule, so
the names match the `$CHECKSTACK_*` vars the backend injects at run time.

## Secret Handling Best Practices

### 1. Marking Fields as Secrets

Use `configString({ "x-secret": true })` for any sensitive data:
- Passwords
- API keys
- Authentication tokens
- Private keys
- Database connection strings with credentials

```typescript
import { configString, configNumber } from "@checkstack/backend-api";

const schema = z.object({
  // Regular field
  timeout: configNumber({}).default(5000),
  
  // Secret field
  accessToken: configString({ "x-secret": true }).describe("OAuth access token"),
});
```

### 2. Optional vs Required Secrets

Secrets can be optional or required (via defaults):

```typescript
const schema = z.object({
  // Optional secret (can be empty)
  password: configString({ "x-secret": true }).optional().describe("Password (optional)"),
  
  // Required secret (has default, but user should change it)
  apiKey: configString({ "x-secret": true }).default("").describe("API Key"),
});
```

### 3. Configuration Retrieval Security

When returning current configuration to the frontend for editing:

```typescript
// ✅ CORRECT: Use getRedacted() to remove secrets
getConfiguration: os.getConfiguration.handler(async ({ context }) => {
  const config = await context.configService.getRedacted(
    pluginId,
    plugin.configSchema,
    plugin.configVersion
  );
  
  return { pluginId, config };  // Secrets are empty/undefined
}),

// ❌ WRONG: Exposes unredacted secrets to frontend
getConfiguration: os.getConfiguration.handler(async ({ context }) => {
  const config = await context.configService.get(...);
  return { pluginId, config };  // Security vulnerability!
}),
```

## Testing

Verify schema conversion includes secret metadata:

```typescript
import { describe, test, expect } from "bun:test";
import { toJsonSchema } from "@checkstack/backend-api";
import { myPluginConfigSchema } from "./schema";

describe("Plugin Config Schema", () => {
  test("should mark password field as secret", () => {
    const jsonSchema = toJsonSchema(myPluginConfigSchema);
    
    expect(jsonSchema.properties.password["x-secret"]).toBe(true);
  });
});
```

## Common Mistakes

### ❌ Using Native Zod Method
```typescript
// WRONG: No x-secret metadata
configSchema: zod.toJSONSchema(p.configSchema)
```

### ❌ Forgetting to Import
```typescript
// WRONG: Using wrong function
import { zod } from "@checkstack/backend-api";
configSchema: zod.toJSONSchema(p.configSchema)
```

### ❌ Not Using secret() Helper
```typescript
// WRONG: Regular string field for sensitive data
password: z.string().describe("Password")
```

### ✅ Correct Pattern
```typescript
import { toJsonSchema, configString } from "@checkstack/backend-api";

// In schema
password: configString({ "x-secret": true }).describe("Password")

// In router
configSchema: toJsonSchema(p.configSchema)
```

## Reference Implementations

**Good examples to follow:**
- [`auth-backend/router.ts`](/plugins/auth-backend/src/router.ts) - Uses `toJsonSchema` and `getRedacted`
- [`queue-backend/router.ts`](/plugins/queue-backend/src/router.ts) - Uses `toJsonSchema`
- [`auth-ldap-backend/strategy.ts`](/plugins/auth-ldap-backend/src/strategy.ts) - Uses `secret()` helper

## Inline validation errors

`DynamicForm` can surface validation problems inline on the offending field
instead of only via a toast. Both behaviors are opt-in, so forms that do not
pass the new props are visually and behaviorally unchanged.

| Prop | Type | Purpose |
| --- | --- | --- |
| `showInlineErrors` | `boolean` | When `true`, renders a per-field error under each touched field for empty required fields. Defaults to `false`. |
| `fieldErrors` | `Record<string, string>` | Externally-supplied messages keyed by field path (dot-joined for nested object fields, e.g. `spendCap.tokenBudget`). Use it to display SERVER validation errors inline. |
| `keepExistingSecretFields` | `string[]` | EDIT mode only. `x-secret` field keys whose value is already stored server-side. A blank input on such a field means "keep existing" and counts as valid. |

The validity boolean reported through `onValidChange` derives from the same
per-field error map that drives the inline messages, so the state that
disables a submit button always matches what the user sees.

To map a server error onto fields, the backend attaches the structured zod
issues to the `ORPCError.data` payload under a `CONFIG_VALIDATION`
discriminator:

```typescript
import { ORPCError } from "@orpc/server";

const result = schema.safeValidate(config);
if (!result.success) {
  throw new ORPCError("BAD_REQUEST", {
    message: `Invalid config: ${result.error.message}`,
    data: {
      code: "CONFIG_VALIDATION",
      issues: result.error.issues.map((issue) => ({
        path: issue.path.filter(
          (s): s is string | number =>
            typeof s === "string" || typeof s === "number",
        ),
        message: issue.message,
      })),
    },
  });
}
```

The frontend parses that payload with the pure helpers exported from
`@checkstack/ui` and falls back to a toast for anything not field-mappable:

```typescript
import {
  parseServerValidationData,
  deriveServerFieldErrors,
  omitKeepExistingSecrets,
  listSecretFieldKeys,
} from "@checkstack/ui";

const parsed = parseServerValidationData(error.data);
if (parsed) {
  const { mapped, unmapped } = deriveServerFieldErrors({
    issues: parsed.issues,
    schema,
  });
  // `mapped` -> DynamicForm `fieldErrors`; surface `unmapped` via a toast.
}
```

On edit, strip blank keep-existing secrets before submit so an empty input
does not clear the stored secret:

```typescript
const config = omitKeepExistingSecrets({
  schema,
  value: formConfig,
  keepExistingSecretFields: listSecretFieldKeys(schema),
});
```

## Summary

**Always follow these rules when exposing config schemas to the frontend:**

1. ✅ Use `toJsonSchema()` from `@checkstack/backend-api`, not Zod's native method
2. ✅ Mark sensitive fields with `configString({ "x-secret": true })` in your schemas  
3. ✅ Use `ConfigService.getRedacted()` when returning current config to frontend
4. ✅ Test that secret fields have `x-secret: true` metadata

This ensures:
- Password fields render correctly with show/hide toggles
- Secrets never leak to the frontend
- Consistent security behavior across all plugins
