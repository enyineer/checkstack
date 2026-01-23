# @checkstack/integration-script-backend

## 0.2.2

### Patch Changes

- Updated dependencies [869b4ab]
  - @checkstack/backend-api@0.8.0
  - @checkstack/integration-backend@0.1.11

## 0.2.1

### Patch Changes

- Updated dependencies [3dd1914]
  - @checkstack/backend-api@0.7.0
  - @checkstack/integration-backend@0.1.10

## 0.2.0

### Minor Changes

- f676e11: Add script execution support and migrate CodeEditor to Monaco

  **Integration providers** (`@checkstack/integration-script-backend`):

  - **Script** - Execute TypeScript/JavaScript with context object
  - **Bash** - Execute shell scripts with environment variables ($EVENT*ID, $PAYLOAD*\*)

  **Health check collectors** (`@checkstack/healthcheck-script-backend`):

  - **InlineScriptCollector** - Run TypeScript directly for health checks
  - **ExecuteCollector** - Bash syntax highlighting for command field

  **CodeEditor migration to Monaco** (`@checkstack/ui`):

  - Replaced CodeMirror with Monaco Editor (VS Code's editor)
  - Full TypeScript/JavaScript IntelliSense with custom type definitions
  - Added `generateTypeDefinitions()` for JSON Schema → TypeScript conversion
  - Removed all CodeMirror dependencies

  **Type updates** (`@checkstack/common`):

  - Added `javascript`, `typescript`, and `bash` to `EditorType` union

### Patch Changes

- Updated dependencies [f676e11]
- Updated dependencies [48c2080]
  - @checkstack/common@0.6.2
  - @checkstack/backend-api@0.6.0
  - @checkstack/integration-backend@0.1.9
  - @checkstack/integration-common@0.2.5
