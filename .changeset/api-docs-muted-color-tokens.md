---
"@checkstack/api-docs-frontend": minor
---

Align the muted/unknown colors in the API docs viewer with semantic design
tokens. The gray fallback states (default access-type icon, unknown user-type
badge, and the `null`/`any`/`unknown` schema-type labels) now use
`text-muted-foreground` / `bg-muted` instead of hardcoded `text-gray-*` /
`bg-gray-*` classes, so they track the theme in light and dark mode. The
intentional categorical palettes (per-user-type badge colors and the
string/number/boolean syntax-highlight colors) are unchanged.
