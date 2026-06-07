---
"@checkstack/ai-backend": minor
---

feat(ai): teach the chat assistant how to build working automations

The AI assistant fabricated values it should have sourced from the platform -
an invented `runAs`, a hand-rolled HTTP fetch with a placeholder URL/token, or
a script return value that was never wired downstream - so its proposed
automations failed to save or run.

The chat system prompt now carries an automation-building playbook that tells
the model to discover before drafting: introspect capabilities and schemas,
pick a real `runAs` from `automation.listServiceAccounts` (never invent one),
reference a real `connectionId` from `automation.listConnections` for
integrated systems (never hand-roll an HTTP fetch), model decisions and gates
as a side-effect-free `choose`/`condition` over a prior query action's
artifact, fall back to a fetch script with `secretEnv` secrets plus
`variables`-sourced URL/params for non-integrated systems (and tell the
operator to allowlist egress to that host), give every output-producing action
an id and wire it downstream with the full
`{{ artifacts.<actionId>.<artifactType>.<field> }}` path (the `<artifactType>`
segment is required and easy to drop, which silently resolves to `undefined`),
and validate any script with `automation.testScript` before proposing.
