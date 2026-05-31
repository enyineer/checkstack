---
"@checkstack/ui": minor
---

Add an "expand to overlay" popout to the shared `CodeEditor` so big scripts (shell / TypeScript / JavaScript) can be edited comfortably in a large full-screen overlay.

Every consumer of `CodeEditor` (automation Run Script, healthcheck collectors, etc.) now gets a subtle "Expand editor" affordance (a `Maximize2` icon button) in the editor's top-right corner. Clicking it opens the shared `Dialog` at `size="full"` containing a large editor that fills the dialog.

- The overlay editor is a second `TypefoxEditor` instance bound to the SAME `value` / `onChange` and all the same completion props (`typeDefinitions`, `templateProperties`, `shellEnvVars`, `markers`, `acquireTypes`, `acquireResetKey`, `importablePackages`, `language`, `readOnly`, `placeholder`), so IntelliSense / ATA / import-name / shell-var completion all work in the overlay exactly as inline. Both editors are controlled on the same value, so edits stay in sync and closing the dialog keeps them.
- The overlay editor only MOUNTS while the dialog is open (lazy), so there is no second Monaco instance cost when closed. It uses a distinct `${id}-popout` model id so the two Monaco models don't fight over the same URI.
- New opt-in `TypefoxEditor` prop `fillHeight`: when true the editor container uses `height: 100%` (with `minHeight` as a floor) instead of a fixed px height, so it fills the tall flex dialog body and Monaco's `automaticLayout` resizes to fit. Inline behaviour is unchanged when `fillHeight` is absent/false.
- `CodeEditorProps` gains two additive optional props: `allowPopout` (default `true`; set `false` to hide the affordance) and `title` (override the overlay dialog title, which otherwise derives from `language`, e.g. "Edit script - TypeScript").
- `TypefoxEditor` is now properly controlled: external `value` changes are applied to the live model (guarded by an equality check so a user's own edit is a no-op and there's no loop). This is what keeps the inline and popout editors in sync — editing one updates the other — and also fixes external resets (YAML→Visual, loaded definitions) reflecting in the editor.
- `DialogContent`'s inner content wrapper gains `min-h-0 flex-1` so it fills the height when a consumer makes `DialogContent` a tall flex column (e.g. the popout body). Inert for the default non-flex dialog, so existing dialogs are unaffected.

The `Dialog` already degrades its own animations under `usePerformance` / `isLowPower`; the popout button adds no heavy effects.
