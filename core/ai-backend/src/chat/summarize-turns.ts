import { generateText, type LanguageModel, type LanguageModelUsage } from "ai";

/**
 * Render + summarize the OLDEST turns of a conversation into a running prose
 * summary (context compaction). The pure `renderRowsForSummary` builds the
 * transcript text the model summarizes; `summarizeTurns` is the impure model
 * call. Split so the rendering (truncation, tool-activity notes) is unit-tested
 * without a model.
 */

/** Minimal message-row shape the renderer reads (a subset of `AiMessageRow`). */
export interface SummaryInputRow {
  role: string;
  content: Record<string, unknown>;
  toolCalls?: Array<Record<string, unknown>> | null;
  modelMessages?: Array<Record<string, unknown>> | null;
}

/** Cap on the transcript fed to the summarizer, so the summary call itself
 *  can never overflow the window when a huge batch is being compacted. */
export const MAX_SUMMARY_INPUT_CHARS = 24_000;

/**
 * Render rows (oldest-first) into a compact transcript. Each row becomes one
 * `ROLE: text` line; a turn that used tools is flagged `[used tools]` (the
 * verbose tool payloads themselves are intentionally dropped — they are the
 * bulk we are compacting away, and the assistant's text usually states what it
 * found). Truncated to `maxChars` from the HEAD so the oldest context that is
 * about to be dropped is what gets summarized.
 */
export function renderRowsForSummary({
  rows,
  maxChars = MAX_SUMMARY_INPUT_CHARS,
}: {
  rows: SummaryInputRow[];
  maxChars?: number;
}): string {
  const lines: string[] = [];
  for (const row of rows) {
    const text =
      typeof row.content?.text === "string" ? row.content.text.trim() : "";
    const usedTools =
      (row.toolCalls?.length ?? 0) > 0 || (row.modelMessages?.length ?? 0) > 0;
    if (!text && !usedTools) continue;
    const role = row.role.toUpperCase();
    const toolNote = usedTools ? " [used tools]" : "";
    lines.push(`${role}: ${text}${toolNote}`.trim());
  }
  const transcript = lines.join("\n");
  if (transcript.length <= maxChars) return transcript;
  return `${transcript.slice(0, maxChars)}\n...[older content truncated]`;
}

const SUMMARY_SYSTEM_PROMPT =
  "You compress a chat transcript into a concise running summary for an " +
  "operations assistant. Preserve concrete facts, decisions, entity names and " +
  "ids, numbers/metrics, and any unresolved questions or pending actions. " +
  "Merge the prior summary (if any) with the new excerpt into ONE coherent " +
  "summary. Be terse, factual, and omit pleasantries. Output only the summary.";

/**
 * Fold `transcript` (and any `priorSummary`) into a single updated summary via
 * the same connection's model. Bounded output. Returns the new summary plus the
 * call's token usage so the caller can record it against the spend ledger.
 */
export async function summarizeTurns({
  model,
  priorSummary,
  transcript,
}: {
  model: LanguageModel;
  priorSummary: string;
  transcript: string;
}): Promise<{ summary: string; usage: LanguageModelUsage }> {
  const prompt = `${
    priorSummary ? `Prior summary:\n${priorSummary}\n\n` : ""
  }New transcript excerpt to fold in:\n${transcript}`;
  const { text, usage } = await generateText({
    model,
    system: SUMMARY_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: 700,
  });
  return { summary: text.trim(), usage };
}
