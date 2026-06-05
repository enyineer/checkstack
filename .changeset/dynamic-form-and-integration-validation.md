---
"@checkstack/ui": minor
"@checkstack/integration-frontend": minor
"@checkstack/integration-backend": minor
---

Surface integration connection validation errors inline, and fix blank secrets clearing stored credentials on edit.

`@checkstack/ui` `DynamicForm` gains opt-in, backward-compatible props plus pure DOM-free helpers:

- `showInlineErrors` (default `false`): renders a concise per-field error under each touched required field; the `onValidChange` validity boolean derives from the same per-field error map.
- `fieldErrors`: an externally-supplied `{ [fieldPath]: message }` map (dot-joined for nested fields) for surfacing SERVER validation inline; nested paths flag their parent.
- `keepExistingSecretFields`: in EDIT mode, lists `x-secret` keys already stored server-side - a blank input means "keep existing" and is treated as VALID (CREATE mode omits it). New exported helpers: `deriveClientFieldErrors`, `deriveServerFieldErrors`, `parseServerValidationData`, `omitKeepExistingSecrets`, `listSecretFieldKeys`. `DynamicForm` also no longer shows a required (`*`) marker on the child fields of an OPTIONAL nested object while that object is empty (e.g. the OpenAI-compatible `spendCap`); required nested objects are unchanged.

`@checkstack/integration-backend`: connection-config validation failures attach the structured zod issues to `ORPCError.data` under a `CONFIG_VALIDATION` discriminator; the human-readable message is unchanged.

`@checkstack/integration-frontend` `ProviderConnectionsPage`: validation failures appear inline on the offending fields (the toast remains a fallback); Create/Save stays disabled while invalid; on edit a blank `x-secret` field is treated as "keep existing" (no required error, omitted from the update so the stored secret is not cleared).

BREAKING CHANGES: none. The new `DynamicForm` props are optional and default to previous behavior.

This is a beta minor.
