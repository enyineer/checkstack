---
"@checkstack/backend-api": patch
"@checkstack/ai-backend": patch
"@checkstack/ai-frontend": patch
---

Fix "Date cannot be represented in JSON Schema" crashing the AI chat. Zod v4's
`toJSONSchema()` throws on `z.date()` (and even `z.coerce.date()`) by default,
and the chat hit this in TWO places:

- **`@checkstack/backend-api`** `toJsonSchema()` (the OpenAPI generator and AI
  tool-introspection / MCP substrate) called it with no options.
- **`@checkstack/ai-backend`** the agent loop hands the Vercel AI SDK the raw
  Zod tool input, and the SDK runs its OWN `toJSONSchema()` (throwing) to build
  the model-facing tool schema - so a single date field in any tool input
  crashed every chat turn (the whole tool list is projected before the model is
  called).

Both now render dates as `{ type: "string", format: "date-time" }` (their wire
shape) and degrade other unrepresentable types to `{}` instead of throwing.

For the model boundary, a single `dateSafeModelSchema()` helper hands the SDK a
ready-made date-safe schema plus a validator that COERCES the ISO strings the
model emits back into real `Date`s before parsing with the original schema
(refinements and the downstream RPC client, which expects `Date`s, keep
working). A single `toModelSchema()` entry point applies this at EVERY point a
schema is handed to the model - chat tool inputs, the headless agent runner's
tool inputs (the automation "AI Action"), and `generateObject` structured
output - gated so non-date schemas are untouched, so individual tool / agent
definitions never special-case dates. Regression tests cover the converter, the
AI tool serializer, and the model-schema generation + coercion helper, including
the full inbound round-trip with the exact ISO shape a live model emits
(`...T22:00:00Z`, no milliseconds).

**Timezone correctness.** Because the model produces dates as text, the chat now
enforces an unambiguous wire contract: a date-time tool argument MUST be RFC 3339
with an explicit timezone offset. Zone-less (`2026-07-01T22:00:00`) and date-only
(`2026-07-01`) values are rejected with a model-readable error (the model
self-repairs), instead of being silently interpreted in the pod's local zone -
which would resolve the same string to different instants across pods. To resolve
an operator's bare "22:00", the browser's IANA timezone is sent with every chat
turn and folded into the system prompt, so each operator's times are interpreted
in their own zone by default. When no browser zone is available (a headless
automation AI Action), the reference zone falls back to the host/container
timezone (`TZ`), not UTC. A format-matrix test covers every common shape a model
might emit. The chat UI shows the operator which timezone is in use, and the
`TZ` override is documented for operators.

**Current time in context.** The model has no clock, so the system prompt now
includes the current instant (UTC plus the reference-zone wall clock), letting it
resolve relative dates like "today at 10:00" without asking. Applied to both the
chat and the headless agent runner, computed per turn/run so it is never stale.

**Less-strict topic classifier.** The chat's off-topic pre-classifier was
refusing legitimate requests like "create a maintenance" because maintenances
(and several other domains) were not listed. The classifier now enumerates the
full domain set and treats any create/list/update/delete action on a platform
resource as on-topic by default.
