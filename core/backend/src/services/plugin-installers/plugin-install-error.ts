/**
 * Typed error thrown by per-source installers, the bundle resolver, and the
 * compatibility checker. The router catches these and maps `code` to the
 * matching oRPC error code so the UI sees a meaningful HTTP status + message
 * instead of a generic "Internal server error".
 *
 * Throw a plain `Error` for genuine unexpected failures — those become 500s.
 * Throw a `PluginInstallError` for any condition the user can fix (bad
 * package name, network 404, validation failure, missing GHE token, etc.).
 */
export type PluginInstallErrorCode =
  | "NOT_FOUND" // resource doesn't exist (npm 404, github tag not found, …)
  | "BAD_REQUEST" // malformed input the user gave us
  | "UNAUTHORIZED" // auth required (private repo, no token, …)
  | "FORBIDDEN" // auth provided but rejected by the source
  | "PAYLOAD_TOO_LARGE" // tarball over the size cap
  | "BAD_GATEWAY" // upstream registry/github responded with a 5xx
  | "VALIDATION_FAILED" // metadata schema rejected the package.json
  | "COMPATIBILITY_FAILED" // dep ranges don't satisfy the platform
  | "NOT_IMPLEMENTED"; // catalog source (coming soon)

export class PluginInstallError extends Error {
  constructor(
    public readonly code: PluginInstallErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PluginInstallError";
  }
}

export function isPluginInstallError(
  value: unknown,
): value is PluginInstallError {
  return value instanceof PluginInstallError;
}
