---
"@checkstack/logstream-common": minor
"@checkstack/logstream-backend": minor
"@checkstack/logstream-frontend": patch
"@checkstack/ai-backend": patch
---

Make the pattern-metric VariableIndex picker self-explanatory:

- Each variable option now shows its TEMPLATE CONTEXT (one token each side,
  `…`-elided), e.g. `Variable 0 (… after <*> retries) - samples: 3`. This
  disambiguates which `<*>` a variable is when the template also contains
  embedded wildcards (`db-<*>`) - those keep their static text during masking,
  their values are never captured, and they are NOT variables. The
  `variableIndex` field description now explains this too.
- A position with no numeric buckets in the summary window now reads
  `no samples in the last 24h` (using the backend-reported
  `summaryWindowSeconds`, not a hardcoded claim) instead of the misleading
  `no recent samples (not numeric)` - an empty window says nothing about
  whether the values are numeric.
- Contract: `PatternVariableSample` gains `context`, and
  `listPatternVariables` returns `summaryWindowSeconds`.
- Docs: the logstream developer guide now documents the standalone-vs-embedded
  wildcard rule (docs index regenerated).
