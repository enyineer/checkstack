/**
 * Parsed cockpit CLI arguments. The cockpit is the single dev entry point
 * (`bun run dev`), hosting the dev-run instance and the PR-preview flow. The
 * flags are ALSO the agent-facing interface: an agent can launch a preview
 * non-interactively with `--prs 380,381`, or manage the snapshot with `--wipe`
 * / `--fresh`.
 */
export interface CockpitArgs {
  /** Frontend serving mode for the dev-run view. `preview` serves the prod build. */
  readonly devMode: "dev" | "preview";
  /** Which view the cockpit opens on. `--prs` implies `pr-preview`. */
  readonly view: "dev" | "pr-preview";
  /** PR numbers from `--prs 380,381` (skips the selection UI). */
  readonly prNumbers?: number[];
  /** `--wipe`: drop the preview db snapshot and exit without starting. */
  readonly wipe: boolean;
  /** `--fresh`: re-snapshot the dev db before starting the preview. */
  readonly fresh: boolean;
  /** Instance namespace for the preview instance. */
  readonly namespace: string;
}

/** Parse a comma-separated PR list ("380, 381,x") into positive ints. */
export function parsePrNumbers(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Read the value following a `--flag` token, or undefined. */
function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

/**
 * Parse cockpit argv (the slice AFTER the script path). Pure and total: unknown
 * tokens are ignored. `--prs` selects the pr-preview view; a bare `preview`
 * positional selects the prod-build serving mode for the dev-run view.
 */
export function parseCockpitArgs(argv: readonly string[]): CockpitArgs {
  const devMode = argv.includes("preview") ? "preview" : "dev";
  const wipe = argv.includes("--wipe");
  const fresh = argv.includes("--fresh");
  const namespace = valueAfter(argv, "--namespace") ?? "preview";

  const prsRaw = valueAfter(argv, "--prs");
  const prNumbers = prsRaw ? parsePrNumbers(prsRaw) : undefined;

  const view: CockpitArgs["view"] =
    prNumbers && prNumbers.length > 0 ? "pr-preview" : "dev";

  return { devMode, view, prNumbers, wipe, fresh, namespace };
}
