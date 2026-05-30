/**
 * Internal (platform-managed) secrets.
 *
 * Some platform secrets are not user-managed named secrets — they back a
 * specific feature (e.g. the script-package registry auth token, or a
 * connection's credential fields). These are stored under a reserved name
 * prefix so they are:
 *
 *  - hidden from the user-facing Secrets UI (`listSecrets` / `listSecretNames`
 *    exclude them — they aren't `${{ secrets.NAME }}`-referenceable names);
 *  - always kept on the local (always-writable, AES-GCM) backend, never the
 *    active external backend (Vault is read-through and has no `set`), so
 *    writing them never breaks when Vault is the active backend.
 */
export const INTERNAL_SECRET_PREFIX = "__internal__:";

/** Build a reserved internal secret name from a namespace + key parts. */
export function internalSecretName(...parts: string[]): string {
  return `${INTERNAL_SECRET_PREFIX}${parts.join(":")}`;
}

/** Whether a secret name is a reserved internal name (excluded from the UI). */
export function isInternalSecretName(name: string): boolean {
  return name.startsWith(INTERNAL_SECRET_PREFIX);
}
