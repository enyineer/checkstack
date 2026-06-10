/**
 * Pure planner for conversation COMPACTION (summarize-old-turns). The chat loop
 * replays the full message history verbatim every turn, so a long conversation
 * — or one verbose tool pull — eventually overflows the model's context window
 * and the provider 400s. This decides, at message-ROW granularity, which oldest
 * rows to fold into a running summary and which recent rows to keep verbatim so
 * the prompt fits the budget.
 *
 * Why ROW granularity: a persisted assistant row carries its WHOLE turn (the
 * assistant message + every tool-call/tool-result part) as one unit, and user
 * rows are atomic. Splitting only at row boundaries therefore can never orphan a
 * tool-call from its result — the malformed sequence a provider rejects.
 *
 * Pure and deterministic: the impure parts (estimating tokens, calling the model
 * to write the summary, persisting it) live in the chat service; this just
 * decides the split given token estimates, so it is unit-tested directly.
 */

export interface CompactionRow {
  id: string;
  /** Estimated tokens this row contributes once expanded to model messages. */
  tokens: number;
}

export interface CompactionPlan {
  /** Row ids (oldest-first) to fold into the running summary this turn. */
  summarizeRowIds: string[];
  /** Row ids (oldest-first) kept verbatim in the prompt. */
  keepRowIds: string[];
  /** True when at least one row must be summarized (a model call is needed). */
  needsSummary: boolean;
}

export function planCompaction({
  rows,
  fixedTokens,
  budgetTokens,
}: {
  /** Not-yet-summarized rows, oldest-first. */
  rows: CompactionRow[];
  /** Tokens already committed regardless of rows: system prompt + prior summary. */
  fixedTokens: number;
  /** Max input tokens the prompt may use (window minus reserved output/margin). */
  budgetTokens: number;
}): CompactionPlan {
  const keep = [...rows];
  const summarize: CompactionRow[] = [];

  const sum = (list: CompactionRow[]) =>
    list.reduce((acc, r) => acc + r.tokens, 0);

  // Drop the OLDEST kept row into the summary set until the prompt fits, but
  // ALWAYS keep the most recent row (the current user turn) verbatim — there is
  // nothing newer to fall back to, and summarizing the live question is useless.
  while (keep.length > 1 && fixedTokens + sum(keep) > budgetTokens) {
    const oldest = keep.shift();
    if (oldest) summarize.push(oldest);
  }

  return {
    summarizeRowIds: summarize.map((r) => r.id),
    keepRowIds: keep.map((r) => r.id),
    needsSummary: summarize.length > 0,
  };
}
