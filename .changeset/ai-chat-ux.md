---
"@checkstack/ai-frontend": minor
"@checkstack/ai-backend": minor
"@checkstack/ai-common": minor
"@checkstack/ui": minor
---

AI chat UX: ordered turns, readable diffs, persistent errors, auto-titles, decision acknowledgments, and a smarter topical guard.

- Turns render as ordered parts (text / tool-call status / confirm card) in chronological order, with inline tool-error lines and a mid-turn "Thinking..." indicator, instead of one text blob plus a flat tool list. The confirm card and tool-step parts no longer vanish after a turn finishes (hydration seeds once per conversation id via `useInitOnceForKey`, so background refetches are no-ops).
- Errors persist: in-stream provider errors are lifted into the chat hook's durable error state and shown in a dismissible banner with selectable text and a Copy button (single-line digest, full text on hover); it clears on send / open / new chat. The backend installs an `onError` handler that logs the provider's full HTTP response and returns a readable message, and normalizes the model message history (drop empty rows, merge consecutive same-role rows, strip a leading non-user row) so a single provider hiccup can no longer brick a conversation.
- Confirm/applied card diffs render as a GitHub-style split diff (line-number gutters, per-line tint, word-level highlighting, an "Expand" pop-out). `computeFieldDiff` recurses into arrays element-wise so a single changed leaf is pinpointed instead of dumping whole serialized arrays.
- Conversations auto-title after the first user message (cheap `generateText` reusing the turn's model, fire-and-forget, heuristic fallback). "New chat" opens immediately and reuses an empty untitled draft instead of spawning duplicates; "Delete" is a soft archive (`archived_at` on `ai_conversations`, data retained). A clean model picker always renders a `Select` of `[defaultModel, ...availableModels]` de-duplicated.
- The assistant acknowledges a confirm-card decision (a new `decision` mode -> `streamDecision`) instead of going silent after an apply/decline; the decision note is derived server-side from the stored proposal and is ephemeral.
- A cheap topical pre-classifier short-circuits off-topic turns with a canned refusal (fail-open, spend recorded). It marks meta/capability/greeting/how-to questions as ON_TOPIC; only clearly unrelated requests (coding help, creative writing, trivia) are refused.
- The chat agent no longer emits duplicate proposals for one request: propose/auto-apply results carry an explicit model-facing "stop and wait" note, and a per-turn `<tool>:<argsHash>` dedupe short-circuits repeated identical mutating calls.
- Assistant messages render through the shared `<MarkdownBlock>`: it now parses a SAFE subset of raw HTML (`rehype-raw` + `rehype-sanitize`) so native `<details>`/`<summary>` widgets render, and enables `remark-gfm` so GFM tables, strikethrough, and autolinks render (the assistant often summarizes drafts as tables).

State and scale: the archive marker, titles, and permission mode all live in the shared `ai_conversations` table, read identically on every pod; the classifier holds no state and its spend is recorded in the shared `ai_spend` ledger. No new pod-local state.

This is a beta minor.
