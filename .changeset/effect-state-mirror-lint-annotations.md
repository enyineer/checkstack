---
"@checkstack/automation-frontend": patch
"@checkstack/theme-frontend": patch
---

Annotate two deliberate effect-based state mirrors with the
`checkstack/no-state-seed-in-effect` lint rule: the automation edit page's
YAML-tab mirror of the visual editor's `definition`, and the theme toggle's
mirror of the global resolved theme. Both are one-way mirrors of values the user
never edits directly, so they are safe exceptions to the rule. Comment-only - no
runtime behavior change.
