/**
 * Pure matching logic powering the Monaco shell-env-var completion
 * provider. Kept in its own file so we can unit-test the matcher without
 * spinning up a real Monaco instance — and so any regex changes are
 * caught by the test suite rather than at smoke-test time.
 *
 * Given the text from the start of the line up to (but not including) the
 * cursor, return either:
 *   - `null` if the cursor isn't sitting at a `$`-prefixed env-var
 *     reference, or
 *   - the shape of the match: which form (`bare` / `braced`), what the
 *     user has typed so far (`query`), and how many columns the
 *     completion range starts to the left of the cursor (`prefixLength`).
 */
export interface ShellEnvVarMatch {
  /** "bare" for `$NAME`, "braced" for `${NAME}` (still being typed). */
  form: "bare" | "braced";
  /** What the user has typed after the `$` or `${`, uppercased for matching. */
  query: string;
  /** Length of the prefix to replace when inserting the completion. */
  prefixLength: number;
}

const BRACED = /\$\{([A-Z0-9_]*)$/i;
const BARE = /\$([A-Z0-9_]*)$/i;

/**
 * Inspect the line text up to the cursor and decide whether to offer
 * env-var completions.
 *
 * `${` takes priority over a bare `$` so that, when the user has already
 * opened a brace, we close the completion with `${NAME}` (and don't
 * accidentally suggest a bare `$NAME` which would leave a stray `${`
 * dangling in front).
 */
export function matchShellEnvVarTrigger(
  textBeforeCursor: string,
): ShellEnvVarMatch | null {
  const braced = BRACED.exec(textBeforeCursor);
  if (braced) {
    return {
      form: "braced",
      query: (braced[1] ?? "").toUpperCase(),
      prefixLength: braced[0].length,
    };
  }

  const bare = BARE.exec(textBeforeCursor);
  if (bare) {
    return {
      form: "bare",
      query: (bare[1] ?? "").toUpperCase(),
      prefixLength: bare[0].length,
    };
  }

  return null;
}

/**
 * Build the snippet to insert for a matched env-var completion. The form
 * mirrors what the user already typed: `${NAME}` if they opened a brace,
 * `$NAME` otherwise. Either is valid POSIX shell.
 */
export function buildShellEnvVarInsertText(
  match: ShellEnvVarMatch,
  varName: string,
): string {
  return match.form === "braced" ? `\${${varName}}` : `$${varName}`;
}
