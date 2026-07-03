import { aiConversations, aiMessages } from "@checkstack/ai-backend/src/schema";
import type { SeedDb } from "./db.ts";

/**
 * One rendered chat turn. The chat page hydrates a reloaded transcript from
 * `ai_messages.content.text` only (assistant turns render that text as
 * markdown, user turns as a plain bubble), so a persisted `{ text }` payload is
 * all a screenshot needs - no tool-call / model-message replay data.
 */
interface Turn {
  role: "user" | "assistant";
  text: string;
}

/**
 * A believable multi-turn transcript: an operator triaging the seeded active
 * "checkout 5xx" incident with the assistant. Assistant turns use markdown
 * (bold, lists, code) so the rendered bubble shows the real formatting the
 * MarkdownBlock renderer produces.
 */
const TURNS: Turn[] = [
  {
    role: "user",
    text: "Checkout is throwing 5xx for some carts. What changed in the last hour?",
  },
  {
    role: "assistant",
    text: "I pulled the recent signals for **Checkout API**:\n\n- Its health check flipped to **unhealthy** 34 minutes ago, right after `payments-service` started failing.\n- There is an **open major incident** already linked to both systems.\n- The dependency map shows checkout depends on payments with a `hard` impact, so a payments outage cascades to checkout submits.\n\nMost likely the checkout 5xx are a downstream symptom of the payments degradation, not an independent failure.",
  },
  {
    role: "user",
    text: "Makes sense. Is the payments issue new or has it been flapping?",
  },
  {
    role: "assistant",
    text: "It is new, not flapping. Over the last 3 days `payments-service` held a **99.2%** success rate with no state transitions until today. The current transition is a single clean drop to unhealthy 36 minutes ago - a step change, not the sawtooth you'd see with a flapping check.\n\nThe anomaly engine also flagged the latency spike as a confirmed anomaly against its learned baseline.",
  },
  {
    role: "user",
    text: "Draft a status update for the incident I can post to affected customers.",
  },
  {
    role: "assistant",
    text: "Here is a customer-facing update you can paste into the incident:\n\n> **Investigating - checkout errors**\n>\n> We are aware that some customers are seeing errors when completing checkout. We have traced this to a degraded payments dependency and are failing over now. Carts and saved items are unaffected. Next update in 30 minutes.\n\nWant me to attach this to the open incident and set its status to **identified**?",
  },
];

/**
 * Seed one AI chat conversation + its transcript directly into the AI plugin's
 * tables. The chat page requires (a) at least one configured AI integration -
 * created via `seedAiIntegration` - so the transcript area is not gated behind
 * the "No AI integration configured" empty state, and (b) a conversation the
 * capturer opens from the sidebar. Messages are written with strictly
 * increasing `createdAt` so the conversation-scoped index replays them in order.
 */
export async function seedAiChat({
  db,
  userId,
  integrationId,
  model,
  title,
}: {
  db: SeedDb;
  userId: string;
  integrationId: string;
  model: string;
  title: string;
}): Promise<void> {
  const [conversation] = await db
    .insert(aiConversations)
    .values({
      userId,
      title,
      integrationId,
      model,
      permissionMode: "approve",
    })
    .returning({ id: aiConversations.id });
  if (!conversation) {
    throw new Error("Failed to insert AI conversation for screenshot seed");
  }

  const base = Date.now() - TURNS.length * 60_000;
  await db.insert(aiMessages).values(
    TURNS.map((turn, index) => ({
      conversationId: conversation.id,
      role: turn.role,
      content: { text: turn.text },
      // Increasing timestamps so the transcript renders in authored order.
      createdAt: new Date(base + index * 60_000),
    })),
  );
}

/** The sidebar title the capturer clicks to open the seeded transcript. */
export const AI_CHAT_TITLE = "Checkout 5xx incident triage";
