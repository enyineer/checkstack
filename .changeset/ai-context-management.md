---
"@checkstack/ai-backend": minor
"@checkstack/ai-common": minor
"@checkstack/healthcheck-backend": minor
"@checkstack/healthcheck-common": minor
---

AI assistant context-window management + leaner health-check history for chat.

The assistant previously sent the full conversation history verbatim every turn
with no size bounds, so analyzing historical health-check runs blew the model's
context window fast. Two problems are addressed:

**Verbosity.** Read-tool results are now shaped for the model:

- A generic, last-resort size clamp on every read result (head-trims the largest
  arrays and adds a `_truncated` hint to narrow/paginate) so one wide pull can't
  blow the context — and, since history replays each turn, keep blowing it.
- Projections can declare an optional `projectResult` to return a LEANER
  model-facing shape than the UI procedure (authz + audit still see the full
  result). `healthcheck.runHistory` uses it to drop the opaque ids the model
  merely echoes, keeping time/status/latency/source.
- New `healthcheck.runStats` AI tool (backed by a new public `getRunStats`
  procedure): compact window totals (counts by status, uptime %, latency
  avg/min/max/p95) plus a small capped time series, so "how often / how much
  downtime / uptime over the last N days" questions return aggregates instead of
  thousands of rows. `runHistory`'s description now steers wide-window questions
  here.

**Context limits.** The chat loop now estimates the prompt's tokens (a
provider-agnostic heuristic) against a budget derived from the connection's
context window, and COMPACTS the conversation before it overflows: the oldest
turns are summarized into a durable running summary (persisted on the
conversation row in shared Postgres, so any pod resumes consistently) and dropped
from the verbatim replay, with the summary folded into the system prompt.
Splitting at message-row boundaries keeps tool-call/result pairs intact, and the
summarization step is fail-open. A new optional `contextWindowTokens` on the
OpenAI-compatible connection sets the window (blank = conservative default).

All additive: a new optional connection field, a new public read endpoint, and an
additive `ai-backend` migration (`0009`) adding nullable `summary` /
`summarized_through_message_id` columns to `ai_conversations`.
