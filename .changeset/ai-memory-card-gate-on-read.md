---
"@checkstack/ai-frontend": patch
---

Hide the system-detail "Assistant memory" card for users who cannot read AI
memories. The card assumed system-read access was enough, but `listMemories`
requires the separate `ai.memory.read` rule, so users with system access but
without `ai.memory.read` triggered a failing request (`Missing access:
ai.memory.read`). The card now checks `ai.memory.read` and renders nothing (and
never fires the query) when the user lacks it.
