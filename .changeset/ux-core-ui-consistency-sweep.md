---
"@checkstack/ui": patch
---

UX consistency sweep in the shared UI library:

- `TerminalFeed` now formats its entry timestamps with the shared, locale-aware
  `formatTime` helper instead of a hardcoded `en-US` `toLocaleTimeString`, so
  the terminal clock follows the runtime locale. Added `formatTime` to
  `@checkstack/ui`'s formatting module (24-hour time-of-day with seconds).
- Swapped raw success palette literals for the semantic `--success` token so
  success states render consistently and respect dark mode: `ScriptTestPanel`
  (`text-emerald-500` -> `text-success`), `IDELayout` status bar
  (`text-green-500` -> `text-success`), and `EditableText`'s save button
  (`text-green-*`/`dark:` variants -> `text-success hover:text-success/80
  hover:bg-success/10`).
