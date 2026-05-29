---
"@checkstack/automation-frontend": minor
"@checkstack/ui": minor
---

fix(automation): editor UI fixes — action-config autocomplete, popup edge clamping + scroll, de-misleading action icon

Four fixes to the automation editor's visual mode:

- **Template autocomplete on action config fields.** A provider
  action's config form (e.g. `automation.log`'s `message`) rendered
  plain string fields with no `{{ … }}` autocomplete — only the
  condition/expression fields had it. `DynamicForm` gains a
  `templateCompletionProvider` prop; when supplied, default single-line
  string fields render a `TemplateValueInput` wired to it instead of a
  bare `Input`. The automation editor passes the staged template-mode
  provider, so config fields now get the same field / comparator / value
  / filter completion as conditions. Other `DynamicForm` consumers are
  unaffected (the prop is opt-in; without it string fields stay plain).

- **Autocomplete popup no longer overflows the window.** The popup is
  now edge-aware: it flips above the input when there isn't room below,
  anchors to the input's right edge when a left-anchored popup would
  spill past the right edge, and caps its height to the available space
  (the list scrolls within it). The placement decision is extracted into
  a pure, unit-tested `computePopupPlacement` helper.

- **Keyboard navigation scrolls the popup.** Arrowing through a list
  taller than the popup now scrolls the highlighted row into view
  (`scrollIntoView({ block: "nearest" })`) instead of leaving the
  selection off-screen.

- **Action card icon no longer looks like a run button.** The "action"
  kind used a `Play` triangle, which reads as a test/run control but
  actually sits inside the card's expand toggle (so clicking it just
  collapsed the card). Swapped to `Zap`, the conventional
  automation-action glyph, which carries no "click to run" affordance.

- **Inline-script actions get their typed runtime context.** The Monaco
  editor for `Run Script (TypeScript)` was falling back to an untyped
  default context because the editor never received type definitions.
  `useVariableScope` now also returns the `declare const context: …`
  declarations from `generateAutomationContextTypes` (already built, but
  never wired), and the provider action body forwards them to
  `DynamicForm` so `context.trigger.payload` is typed as the discriminated
  union over the automation's subscribed triggers, with
  `context.artifacts` / `context.var` / `context.repeat` in scope at the
  action's position. Shell scripts get their context the same way every
  other config string does: `{{ … }}` templates are expanded by the
  dispatch engine (`renderValue`) before the script runs, with the same
  field autocomplete as other template fields.
