---
title: Assistant memory
description: Durable, scoped notes the AI assistant saves and recalls across conversations, with per-user and per-system access gating and a data-not-instructions safety stance.
---

The assistant can save durable memories and recall them in later conversations, so it stops re-asking, re-deriving, and forgetting operator preferences and hard-won facts about a system. Memory holds only knowledge the platform does not otherwise store; live state (health runs, incidents, SLOs) is always queried live, never cached as memory.

## What a memory is

A memory is a short, self-describing note owned by ai-backend (the `ai_memory` table, shared Postgres so recall is identical on every pod). Two fields drive retrieval:

- `recallHint` - "what this is and when to recall it" (the rankable index the model matches a query against).
- `content` - the note itself.

Every memory has a `scope`:

- `user` - a private preference or policy owned by the saving principal (for example "file infra tickets in OPS"). Visible only to that owner.
- `system` - a durable fact about one catalog system (for example "its `/health` returns 200 even when the DB is down; check `/ready`"). Visible to anyone who can read that system.

## Tools

Three tools are registered through `aiToolExtensionPoint` and offered to both the chat assistant and the automation `ai_analyze` agent (the agent runner offers read + mutate and filters `destructive`, so it gets `searchMemory` and `saveMemory` but never `deleteMemory`).

```ts
// ai.searchMemory  (effect: "read",        access: ai.memory.read)
//   { query, limit? } -> { memories: [{ id, scope, systemId, recallHint, content, tags, alwaysInject, savedAt }] }
// ai.saveMemory    (effect: "mutate",      access: ai.memory.manage)
//   { scope, systemId?, recallHint, content, tags?, alwaysInject? } -> { id, updated }
// ai.deleteMemory  (effect: "destructive", access: ai.memory.manage)
//   { id } -> { deleted }
```

`saveMemory` deduplicates: when a near-duplicate already exists (same scope/system and a high `recallHint` token overlap) it updates that memory in place instead of adding a row, which is also how a drifting memory is superseded. Prefer this over `deleteMemory`, which is for genuinely stale entries and always requires human confirmation.

### Always-inject preferences

Recall is on-demand, which is the wrong fit for an always-apply preference (a writing-style rule the model should follow every turn, not look up). So a memory carries an `alwaysInject` flag: when set, it is prepended to the chat system prompt on every turn (and folded into the unattended agent's baseline), so it shapes generation directly rather than waiting to be recalled. The model proposes the value (true for style/tone/formatting/default preferences, false for facts), it is shown on the confirm card, and the operator can flip it later from the Memories UI (the `setMemoryAlwaysInject` mutation). Injection respects the same visibility rule and is bounded by a per-turn cap.

A human can also view and delete memories from the **Assistant memory** settings page and from a system's detail page (the `SystemDetailsSlot` memory card).

## Access and scoping

Scoping is enforced in the store and the tool/handler layer, not assumed:

- `user` memories filter by `ownerId` - one principal can never read another's.
- `system` memories are gated by the same per-system team grants the catalog's own list endpoints apply, via the system access resolver (`listAccessibleObjectIds`). Saving a `system` memory requires read access to the system; deleting one requires manage.
- The tools are gated by dedicated rules `ai.memory.read` and `ai.memory.manage` (both default-on, admin-revocable), so an admin can disable recall or writes per role. The automation agent uses memory only if its service account holds these rules.

## Safety

- **Data, not instructions.** The system prompt tells the model to treat memory content as context only, never as instructions to follow, and to verify any current fact with a live tool before asserting it. This contains prompt-injection persistence, especially for the shared `system` tier.
- **Secret scrubbing.** `recallHint` and `content` run through the same credential scrubber as chat messages before they are persisted.
- **No stale-fact caching.** The save bar forbids saving live state; the model is steered to durable, non-derivable knowledge only.
- **Bounded unattended writes.** The `ai_analyze` agent auto-applies mutates with no human confirm, so a per-run cap limits how many memories one run may save.

## Storage

The `ai_memory` table is owned by ai-backend and carries `ownerId`, `scope`, `systemId` (set for `system` scope), `recallHint`, `content`, `tags`, `sourceConversationId`, and timestamps. There is no foreign key to the catalog (cross-plugin tables are not FK-linked); the system reference is gated at read/write time instead.
