---
"@checkstack/automation-backend": minor
"@checkstack/automation-frontend": minor
"@checkstack/ui": minor
---

feat(automation): deep + live definition validation surfaces invalid values, keys and ids — marked inline

Previously `validateDefinition` only checked the structural shape via
`AutomationDefinitionSchema`, where an action's `config` is typed as
`z.record(z.unknown())`. So a bad config value (e.g. `level:
debugthisiswrong` on `automation.log`) passed validation, and switching
to the visual editor just showed an empty dropdown with no explanation.

**Backend — deep validation.** New `collectDefinitionIssues` walker
validates the whole definition semantically, not just structurally:

- unknown trigger `event` / action `action` ids,
- each provider action's `config` against the registered action's own
  schema (wrong enum value, missing required field, wrong type),
- each trigger's `config` against the trigger's `configSchema`,
- **unknown / typo'd config keys** — object configs are validated in
  strict mode, so `levle: "info"` is reported rather than silently
  stripped,
- recurses through `choose` / `parallel` / `repeat` / `sequence` so
  nested action configs are covered too.

Issues come back with a dot-joinable `path` (e.g.
`actions.0.config.level`, `triggers.1.event`). The `validateDefinition`
RPC now returns these.

**Frontend — live + inline.** The automation editor re-validates on
every edit (debounced ~400ms) in BOTH tabs, and marks the offending
content in place rather than in a separate alert panel:

- **YAML tab** — issues (and YAML syntax errors) are squiggled at the
  exact node. `@checkstack/ui`'s `CodeEditor` gained a `markers` prop;
  the editor maps each issue's `path` onto the YAML document's node
  range via a new `computeYamlMarkers` helper (walking up to the
  nearest existing ancestor when a key is absent, e.g. a missing
  required field).
- **Visual tab** — the specific card carrying an issue is marked: a
  destructive border + warning icon + the field-level messages. A
  `ValidationProvider` context partitions issues by owner (action card
  / trigger card / condition / top-level) using the action-node path
  grammar, so a nested action's config error attaches to the nested
  card, and a `choose`'s own `when` error attaches to the choose card.
  `ActionCard` gained an `errors` prop. So importing YAML with a bad
  value (the empty-dropdown case) now visibly flags the card instead of
  being silent.

The big error alert is gone; the only residual panel is a slim fallback
for the rare top-level issue that can't attach to any card.

Note: strict config validation means an action whose config schema
intentionally allowed extra keys would now flag them; action configs
across the platform declare all their fields, so this only catches
genuine typos.
