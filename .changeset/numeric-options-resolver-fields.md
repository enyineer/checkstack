---
"@checkstack/ui": patch
"@checkstack/logstream-backend": patch
---

Fix the log-stream pattern-metric collector's VariableIndex picker, which
stayed at "No options available" even after a pattern with `<*>` variables was
selected. Two defects combined:

- The `variableIndex` config field did not declare
  `x-depends-on: ["patternId"]`, so the editor fetched the variable options
  exactly once at mount (before a pattern was chosen) and never re-fetched.
  The schema now declares the dependency, and the picker reloads whenever the
  sibling pattern selection changes.
- `DynamicOptionsField` assumed resolver-backed fields hold string values.
  `variableIndex` is the first `number`/`integer` field with an
  `x-options-resolver`, and picking an option would have stored the string
  `"0"` (rejected by the backend's `z.number().int()`), while a stored numeric
  `0` never matched its option and rendered as unselected. The field now
  receives the schema value type from `FormField` and coerces in both
  directions: picked options emit real numbers, and stored numbers are
  stringified for option matching.

Regression tests cover the number/string round-trip, the sibling-driven
refetch, and the schema annotation.
