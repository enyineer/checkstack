/**
 * Shared naming rule for the run-context environment variables exposed to
 * `run_shell` script actions.
 *
 * Two sides depend on this and must never drift:
 *
 *   - the backend (`integration-script-backend`) injects `NAME=value`
 *     pairs into the shell subprocess at run time, and
 *   - the automation editor lists the available `NAME`s for `$`
 *     autocomplete.
 *
 * Keeping the derivation here, in the package both reach, guarantees the
 * names the editor suggests are exactly the ones the script receives.
 */

/** Prefix on every auto-injected run-context shell env var. */
export const SHELL_ENV_PREFIX = "CHECKSTACK_";

/**
 * Derive the shell env-var name a scope path is exposed under.
 *
 * Rule: uppercase, collapse each run of non-alphanumeric characters to a
 * single `_`, trim leading/trailing `_`, then prefix with `CHECKSTACK_`.
 * So `trigger.payload.title` becomes `CHECKSTACK_TRIGGER_PAYLOAD_TITLE`
 * and `artifact.jira.issue.key` becomes `CHECKSTACK_ARTIFACT_JIRA_ISSUE_KEY`.
 */
export function toShellEnvKey(path: string): string {
  const normalized = path
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")
    // Trim leading/trailing `_`. The negative look-behind on the trailing
    // alternative anchors where the underscore run may start matching,
    // avoiding the polynomial-time backtracking of a naive `/^_+|_+$/g`.
    .replaceAll(/^_+|(?<!_)_+$/g, "");
  return `${SHELL_ENV_PREFIX}${normalized}`;
}
