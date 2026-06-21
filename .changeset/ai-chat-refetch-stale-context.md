---
"@checkstack/ai-backend": minor
---

Tell the assistant to re-fetch when resuming an idle conversation.

The chat loop replays earlier tool results verbatim with no age annotation, and
the system prompt injects "current time" but never how long the thread has been
idle. So resuming an old chat, the model answered from stale captured data (a
check's old name, a "failing" status) instead of the current state.

The turn now measures the idle gap before the message (the conversation's
last-activity timestamp, captured before the new message is appended) and, once
it exceeds 10 minutes, folds a "Data freshness" directive into the system prompt
instructing the model to re-call the relevant read tools for current state
rather than trust results from earlier in the thread. The directive sits at the
volatile end of the prompt (next to the time line), so the cache-friendly stable
prefix is unaffected; an active back-and-forth never sees it.
