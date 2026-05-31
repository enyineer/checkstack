---
"@checkstack/ui": minor
---

Collapse `ScriptTestPanel` behind a compact disclosure by default.

The inline script-test panel previously expanded its sample-context editor and results under every testable script field. It now defaults to collapsed: a compact "Test script" affordance shows, and the panel expands on demand. Running a test still auto-expands the results, and the last run's outcome surfaces as a badge while collapsed. A new `defaultOpen` prop opts back into the always-expanded behaviour.
