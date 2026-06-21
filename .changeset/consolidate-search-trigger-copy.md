---
"@checkstack/ui": patch
"@checkstack/command-frontend": patch
---

Consolidate the two search-trigger affordances onto a single source of truth.

The hero `CommandPalette` (in `@checkstack/ui`) and the wired navbar trigger
(`NavbarSearch` in command-frontend) had drifted in copy and shortcut-hint
rendering. Both now draw their wording and keyboard hint from one shared place:

- New `SEARCH_TRIGGER_LABEL` / `SEARCH_TRIGGER_PLACEHOLDER` constants and a
  platform-aware `SearchShortcutHint` component (⌘K on Mac, Ctrl+K elsewhere) in
  `@checkstack/ui`, consumed by both triggers so the copy and shortcut can no
  longer diverge.
- The hero placeholder was corrected from the over-promising "Search systems,
  incidents, or run commands..." to the accurate "Search and commands...", and
  it now renders the same Mac/non-Mac shortcut hint the navbar uses.

No behavioral change to the global Cmd/Ctrl+K listener.
