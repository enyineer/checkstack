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
shape) and degrade other unrepresentable types to `{}` instead of throwing. For
the agent loop, date-bearing tool inputs are handed a ready-made date-safe
schema plus a validator that COERCES the ISO strings the model sends back into
real `Date`s before parsing with the original schema (refinements and the
downstream RPC client, which expects `Date`s, keep working). Non-date tools are
untouched. Regression tests cover the converter, the AI tool serializer, and the
agent-loop schema/coercion path.
