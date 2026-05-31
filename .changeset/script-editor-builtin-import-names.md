---
"@checkstack/ui": minor
---

Suggest Node and Bun built-in modules in script-editor import-name completion.

The import-specifier completion now also offers the always-available runtime built-ins (`node:fs`, bare `fs`, `bun`, `bun:test`, `node:crypto`, ...) alongside the installed allowlist packages. These are importable in the script sandbox regardless of the allowlist (the sandbox is a Bun subprocess, which provides Node's builtins plus its own `bun:` modules), and their types are already loaded ambiently, so completing one needs no lazy acquisition.

- The built-in name list is DERIVED authoritatively at build time from the same bundled `@types/node` + `bun-types` declarations the editor injects: every importable built-in is a top-level `declare module "<spec>"`, so the generator (`scripts/generate-stdlib-types.ts`) now also parses those names (via the new pure `extractBuiltinModuleSpecifiers`) and emits `generated/builtin-modules.json`. No hand-maintained list - it auto-updates whenever the bundled types are regenerated. Wildcard / asset-glob ambient shims (names containing a star, e.g. asset globs or a `bun.lock` path glob) are filtered out.
- The completion provider merges built-ins with the injected installed packages (deduped + sorted via the pure `mergeImportCompletionEntries`), labelling each via `detail` ("Node.js" / "Bun built-in" / "installed package"). Built-ins appear even when the allowlist is empty; the provider still only fires inside an import-string position and coexists with the TS worker's own completions.

The existing node/bun stdlib TYPE hosting is unchanged (still injected from the separately code-split `stdlib-types.json` asset), so global completions (`process.*`, `Buffer`, ...) and member completions (`import * as fs from "node:fs"`) are unaffected. New pure helpers are fully unit-tested; the Monaco glue is untested per the no-DOM rule.
