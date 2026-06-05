---
title: Permission mode
description: The per-conversation approve/auto permission mode, the three gating tiers keyed on a tool's effect, and the invariant that destructive tools can never auto-apply.
---

Each chat conversation carries a permission mode, Claude-Code-style, that decides how a non-destructive change a model proposes reaches effect. The mode governs the `mutate` tool branch only: reads always run and destructive tools always require a human approval, regardless of the mode. The default for a new conversation is `approve` (safe-by-default).

## The two modes

- `approve`: a `mutate` tool surfaces a confirm card the operator approves via `applyTool`. This is the existing propose to apply flow.
- `auto`: a `mutate` tool is applied immediately, server-side, with no human click. The apply runs through the same propose to apply service the human path uses (same authorization re-check, same audit rows), so `auto` is faster, never weaker.

## The three gating tiers

Gating keys on the tool's `effect` (`read | mutate | destructive`):

- `read` always auto-runs, in both modes. Reads are never gated; the mode does not affect them.
- `mutate` inherits the mode. In `auto` it auto-applies server-side; in `approve` it surfaces a confirm card.
- `destructive` always requires the human `applyTool`, in both modes. The mode is never consulted for destructive tools.

The decision is a single pure function so it is exhaustively testable:

```ts
export function decideToolDisposition({
  effect,
  mode,
}: {
  effect: AiToolEffect;
  mode: AiPermissionMode;
}): "auto-run" | "auto-apply" | "propose" {
  if (effect === "read") return "auto-run"; // tier 1: never gated
  if (effect === "destructive") return "propose"; // tier 3: always human
  return mode === "auto" ? "auto-apply" : "propose"; // tier 2: mode-governed
}
```

## Security invariant: destructive can never auto-apply

The mode has no parameter into the destructive apply path. It is consulted only on the `mutate` branch, so there is no `(effect, mode)` pair that routes a destructive tool to `auto-apply`. A test asserts that no permission-mode value changes a destructive tool's requirement for a human `applyTool` call, and that `auto-apply` is reachable only via `(mutate, auto)`.

> [!IMPORTANT]
> Setting a conversation to `auto` only ever skips the human click for non-destructive `mutate` tools. Deletes and other irreversible actions still require explicit confirmation.

## Where the mode lives

The mode is a durable, per-conversation `permission_mode` column on `ai_conversations` (shared Postgres), defaulting to `approve`. It is read from the conversation row at the start of each turn, so a turn handled on any pod reads the same mode. The conversation row is the single writer; the chat header toggle is a view of it, persisted via `updateConversation` (owner-scoped, mirroring how `model` and `title` are handled). See the [propose and apply](/checkstack/developer-guide/ai/propose-apply/) page for the apply path the `auto` mode reuses.
