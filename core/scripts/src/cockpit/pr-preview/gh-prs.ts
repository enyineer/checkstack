import { z } from "zod";
import type { ExecRunner } from "./exec.ts";

/**
 * The PR fields the tool needs. `gh pr list --json <fields>` returns exactly
 * these keys, so the schema doubles as the parse + validation of gh's output.
 */
export const prInfoSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  headRefName: z.string(),
  isDraft: z.boolean(),
  author: z.object({ login: z.string() }).nullable().optional(),
  updatedAt: z.string(),
  /** MERGEABLE | CONFLICTING | UNKNOWN (gh's mergeable state). */
  mergeable: z.string().optional(),
});
export type PrInfo = z.infer<typeof prInfoSchema>;

const prListSchema = z.array(prInfoSchema);

/** The gh `--json` field list, kept in one place so it matches the schema. */
export const GH_PR_JSON_FIELDS =
  "number,title,headRefName,isDraft,author,updatedAt,mergeable";

/**
 * Parse the raw stdout of `gh pr list --json ...` into validated PRs, sorted
 * most-recently-updated first. Pure (no process spawn) so it is directly
 * unit-testable against captured gh output.
 */
export function parsePrList(stdout: string): PrInfo[] {
  const json: unknown = JSON.parse(stdout);
  const prs = prListSchema.parse(json);
  return [...prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Fetch open PRs via the `gh` CLI. Throws a clear error if gh is missing, not
 * authenticated, or returns a non-zero exit.
 */
export async function listOpenPrs({
  exec,
  limit = 200,
}: {
  exec: ExecRunner;
  limit?: number;
}): Promise<PrInfo[]> {
  const result = await exec.run({
    command: "gh",
    args: [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      String(limit),
      "--json",
      GH_PR_JSON_FIELDS,
    ],
  });
  if (result.code !== 0) {
    throw new Error(
      `\`gh pr list\` failed (exit ${result.code}). Is the GitHub CLI installed and authenticated (\`gh auth status\`)?\n${result.stderr.trim()}`,
    );
  }
  return parsePrList(result.stdout);
}

/** Result of validating requested PR numbers against the open PRs. */
export interface PrSelectionResult {
  /** Requested PRs that exist and are open, in the requested order. */
  readonly selected: PrInfo[];
  /** Requested numbers that are not open PRs. */
  readonly invalid: number[];
}

/**
 * Resolve caller-requested PR numbers (from `--prs 380,381`) against the list of
 * open PRs. Pure: preserves the requested order, dedupes, and reports any
 * numbers that do not correspond to an open PR so the CLI can error clearly.
 */
export function resolvePrSelection({
  requested,
  available,
}: {
  requested: readonly number[];
  available: readonly PrInfo[];
}): PrSelectionResult {
  const byNumber = new Map(available.map((pr) => [pr.number, pr]));
  const selected: PrInfo[] = [];
  const invalid: number[] = [];
  const seen = new Set<number>();
  for (const num of requested) {
    if (seen.has(num)) continue;
    seen.add(num);
    const pr = byNumber.get(num);
    if (pr) {
      selected.push(pr);
    } else {
      invalid.push(num);
    }
  }
  return { selected, invalid };
}
