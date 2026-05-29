---
"@checkstack/automation-backend": minor
"@checkstack/automation-common": minor
---

feat(automation): backend RPC router with the full 15-endpoint contract

Wires up `core/automation-backend/src/router.ts` covering automation CRUD,
definition validation, manual runs, run history, registry introspection,
and a template playground. The contract is refactored to use the
project's `proc()` pattern so `autoAuthMiddleware` enforces `read` /
`manage` access automatically, and `AutomationApi` is exported via
`createClientDefinition` for the frontend client.
