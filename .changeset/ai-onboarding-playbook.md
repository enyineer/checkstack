---
"@checkstack/ai-backend": minor
---

feat(ai): add an onboarding playbook to the chat assistant

When a monitoring-setup tool is in scope this turn (creating a system, proposing
a health check, or managing environments), the chat system prompt now injects an
onboarding section that steers the model to prefer the HTTP strategy for a URL,
ask before guessing, create-and-assign a check in one step, and use environments
instead of cloning a system per deployment stage. Like the automation playbook,
it stays out of the always-on prompt on pure read turns.
