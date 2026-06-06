---
"@checkstack/backend-api": patch
---

Fix "Date cannot be represented in JSON Schema" crashing the AI chat. Zod v4's
`toJSONSchema()` throws on `z.date()` by default, and `toJsonSchema()` (the
shared substrate for the OpenAPI generator and the AI tool projection) called it
with no options. Many contracts carry date fields (timestamps on incidents,
health checks, anomalies), and the assistant projects the full tool list on
every turn - so a single date field broke every chat message with
"The assistant hit an error: Date cannot be represented in JSON Schema".

`toJsonSchema()` now renders dates as `{ type: "string", format: "date-time" }`
(how they serialize over the wire) and degrades any other unrepresentable type
to `{}` instead of throwing. Regression tests cover the converter and the AI
tool serializer.
