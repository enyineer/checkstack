import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import {
  aiAccess,
  pluginMetadata as aiPluginMetadata,
} from "@checkstack/ai-common";
import type { RegisteredAiTool } from "../tool-registry";

/** One selectable answer to an {@link createAskOperatorTool} question. */
export const AskOperatorOptionSchema = z.object({
  /** The chip label shown to the operator. */
  label: z.string().min(1),
  /**
   * The text sent back as the operator's reply when this chip is clicked.
   * Defaults to the label when omitted.
   */
  value: z.string().optional(),
});

/** Input for `ai.askOperator`: a question plus its clickable options. */
export const AskOperatorInputSchema = z.object({
  /** The question to ask. Keep it short; it renders above the options. */
  question: z.string().min(1),
  /** 1-6 discrete answers, rendered as clickable chips. */
  options: z.array(AskOperatorOptionSchema).min(1).max(6),
  /**
   * Whether the operator may also type a free-text answer instead of clicking a
   * chip. Defaults to true.
   */
  allowFreeText: z.boolean().default(true),
});
export type AskOperatorInput = z.infer<typeof AskOperatorInputSchema>;

/**
 * The marked "question card" the tool returns. The chat frontend detects the
 * `__question` marker (mirroring the confirm card's `__confirm`) and renders the
 * options as clickable chips; the `note` tells the MODEL to stop and wait for
 * the operator's reply (the frontend ignores it).
 */
export interface AskOperatorCard {
  __question: true;
  question: string;
  options: Array<{ label: string; value: string }>;
  allowFreeText: boolean;
  note: string;
}

/**
 * `ai.askOperator` - ask the operator a question with clickable answer options
 * instead of a plaintext list they must type a reply to. The model calls it with
 * a question + 1-6 options; the chat renders them as chips (plus a free-text box
 * when `allowFreeText`), and clicking a chip sends that answer as the operator's
 * next message.
 *
 * `effect: "read"` - it surfaces a UI prompt and commits nothing, so it
 * auto-runs. Calling it ENDS the turn: the operator's selection arrives as a new
 * user message, so the model must stop after calling it (the returned `note`
 * reinforces this, exactly like a confirm card ends a propose turn). Gated by
 * the same chat-use rule as the other platform read tools.
 */
export function createAskOperatorTool(): RegisteredAiTool<
  AskOperatorInput,
  AskOperatorCard
> {
  return {
    name: "askOperator",
    description:
      "Ask the operator a question with clickable answer options instead of a plaintext list. Provide a short question and 1-6 options (each a label, plus an optional value that is sent when clicked). Use this for ANY clarifying question that has discrete choices - which system, which protocol, how often, which environment - rather than asking in prose. Calling this ENDS your turn: the operator's choice arrives as their next message, so do NOT add more text or call other tools after it. For a genuinely free-form answer (e.g. a URL), either ask in prose or set allowFreeText so they can type one alongside the chips.",
    effect: "read",
    input: AskOperatorInputSchema,
    requiredAccessRules: [
      qualifyAccessRuleId(aiPluginMetadata, aiAccess.chatUse),
    ],
    async execute({ input }) {
      return {
        __question: true,
        question: input.question,
        options: input.options.map((option) => ({
          label: option.label,
          value: option.value ?? option.label,
        })),
        allowFreeText: input.allowFreeText,
        note: "These options were shown to the operator as clickable choices. Stop here and wait for their reply; do not restate the options or add more text.",
      };
    },
  };
}
