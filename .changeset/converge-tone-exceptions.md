---
"@checkstack/ui": minor
"@checkstack/dashboard-frontend": patch
"@checkstack/incident-frontend": patch
"@checkstack/queue-frontend": patch
"@checkstack/dependency-frontend": patch
"@checkstack/integration-frontend": patch
"@checkstack/notification-frontend": patch
---

Converge the status-tone exceptions that turned out to be drift

Reviewing the four "deliberate exceptions" left by the tone de-duplication, three
were drift wearing a comment, and one was genuine.

- **`neutralToneStyle` is now exported from `@checkstack/ui`.** Three plugins had
  each written out the same three muted strings by hand. It sits beside
  `pillToneStyles` rather than in it, because the absence of a tone is not a
  tone; `StatusPill`'s `tone="neutral"` renders it.
- **Dashboard signals use the status ladder's blue.** In one record `error` and
  `warn` came from the ladder while `info` reached for the general-purpose
  `--info` accent - so the same "Watch" signal rendered in two different blues
  depending on whether you looked at the problem card, its chip, or the fleet
  header bar. All three now use `--status-info`, which is also the darker L45
  blue chosen precisely so its text stays readable on a light card.
- **The system incident panel borders at `/20`** like every other tinted border,
  removing the last class-string divergence in the tone system along with the
  one-off map that documented it.
- **The queue's neutral pills use the shared neutral.** Its KPI tile and its job
  state pill each carried a slightly softer private variant, so "carries no
  signal" looked like two different things on one page.

The one genuine exception kept: `--info` and `--status-info` remain separate
tokens. The first is the general semantic palette (alongside `--success` /
`--warning`), the second the colourblind-safe status ladder with its own
contrast rationale. Non-status surfaces - the `Alert` component, plugin-type
chips - keep the general accent.
