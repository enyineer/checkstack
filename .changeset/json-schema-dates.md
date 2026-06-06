---
"@checkstack/backend-api": patch
"@checkstack/ai-backend": patch
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
