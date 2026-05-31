---
"@checkstack/slo-backend": minor
---

Remove the dead `slo.budget.warning` / `slo.budget.critical` / `slo.budget.exhausted` / `slo.streak.broken` hook descriptors from `sloHooks`.

These four `createHook` descriptors had no emitter and no trigger registration left: per the reactive automation engine (§9.2) the SLO budget IS the reactive entity, and the old threshold/streak triggers became `numeric_state` / `state` conditions over `state.slo.<objectiveId>.budgetRemainingPercent` + `currentStreak`. Nothing in the repo emitted or subscribed to the four hooks, so they were unreachable surface. `sloAchievementUnlocked` and `sloWeeklyDigest` are unaffected and stay.

BREAKING CHANGES:
- Removed `sloHooks.sloBudgetWarning`, `sloHooks.sloBudgetCritical`, `sloHooks.sloBudgetExhausted`, and `sloHooks.sloStreakBroken`. Author SLO budget / streak threshold automations as reactive `numeric_state` / `state` conditions over the `slo` entity state instead.
