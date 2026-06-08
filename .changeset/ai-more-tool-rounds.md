---
"@checkstack/ai-backend": minor
"@checkstack/automation-backend": minor
---

feat(ai): allow more tool-call rounds per turn

The agent loop's per-turn step budget was tight enough that a thorough
investigation (resolve ids, fan out across signal sources, read several docs)
could exhaust it before answering. Raise the budgets:

- Chat: `MAX_STEPS` 8 -> 16 (the final step is the forced answer, so ~15 rounds
  of actual tool use).
- AI action (headless runner): default `maxSteps` 8 -> 12, and the per-action
  config cap 20 -> 30 so authors can dial it higher for deep tasks.

The per-principal tool rate-limit budget and the optional per-connection spend
cap remain the real cost ceilings, so this only widens how much investigating a
single turn may do, not how much a principal may spend overall.
