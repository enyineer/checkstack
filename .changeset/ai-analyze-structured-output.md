---
"@checkstack/ai-backend": patch
---

Fix the AI analyze action's structured output (`outputFields`) failing on
OpenAI-compatible providers without native structured-output support (OpenRouter,
DeepSeek, Ollama, ...). The JSON schema sent via `responseFormat` is silently
dropped by those providers, and the prompt never described the schema, so the
model was never told which fields were required and omitted them ("No object
generated: response did not match schema"). The structured-output pass now
embeds the JSON Schema in the prompt, so it works on any OpenAI-compatible model.
The repair loop is also more effective: on a failed attempt it now feeds back the
specific field-level validation errors and the model's rejected output (instead
of the generic "did not match schema" message) and reinforces the schema more
firmly on repeated misses.
