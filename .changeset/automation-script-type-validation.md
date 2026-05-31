---
"@checkstack/automation-frontend": minor
"@checkstack/ui": minor
---

Surface inline-script type errors as automation action badges.

Every inline `run_script` action in the automation editor is now type-checked
against its generated `context` types continuously - including actions whose
cards are collapsed - and any errors show up as the action card's error badge
(and in the definition issue list), the same surface structural validation
uses. Previously a type error was only visible as a red squiggle inside the
open Monaco editor, so a broken script behind a collapsed card (or one
invalidated by adding a new trigger) went unnoticed until runtime, where the
bad property access silently read `undefined`.

Validation runs entirely in the browser via the same standalone TypeScript
worker the editor uses (new `validateTypeScriptSources` export on
`@checkstack/ui`), so there is no backend round-trip. Each script is checked by
prepending its generated `context.d.ts` to the source, which keeps the
`context` global scoped to that one off-screen file and avoids colliding with
any open editor. When an automation already contains scripts, a hidden editor
boots the shared editor services on open so validation runs immediately rather
than only after the first script card is expanded.

This covers the automation currently open in the editor. Scripts in other
automations, or definitions authored via YAML/API, are not type-checked here -
that platform-wide coverage remains future work for a backend typecheck.

Also: action cards no longer auto-open their detail sheet when they have
validation issues; issues now surface only as the card badge, so multiple
flagged actions no longer pop several sheets open at once.
