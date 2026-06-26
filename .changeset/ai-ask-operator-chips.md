---
"@checkstack/ai-backend": minor
"@checkstack/ai-frontend": minor
---

feat(ai): clickable answer options in chat (askOperator)

Add an `askOperator` tool the assistant calls to ask a question with clickable
answer chips (plus an optional free-text box) instead of a plaintext list.
Clicking a chip sends that answer as the operator's next message. The chat
renders the chips from a `__question` tool-output card, mirroring the existing
confirm-card pattern, and calling the tool ends the turn (the operator's choice
arrives as their next message).

The system prompt now steers the model to use `askOperator` for discrete-choice
clarifications (which system, which protocol, how often, which environment),
reserving prose questions for free-form values like a URL.
