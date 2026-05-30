/**
 * Render an `.npmrc` for the managed store from registry config.
 *
 * The auth token is written to the on-disk `.npmrc` at install time only;
 * it is NEVER logged or returned to the client. Callers pass the resolved
 * plaintext token (fetched from the connection-store secret) directly to
 * this pure function and write the result to disk.
 */

export interface NpmrcInput {
  registryUrl: string;
  scopedRegistries: { scope: string; registryUrl: string }[];
  /** Resolved plaintext token, or undefined for an anonymous registry. */
  authToken?: string;
}

/** Strip protocol from a registry URL for the `//host/:_authToken` key. */
function registryAuthKey(registryUrl: string): string {
  // `//registry.example.com/:_authToken=...` - npm keys auth by the
  // protocol-relative registry path.
  return registryUrl.replace(/^https?:/, "");
}

export function renderNpmrc(input: NpmrcInput): string {
  const lines: string[] = [`registry=${input.registryUrl}`];

  for (const scoped of input.scopedRegistries) {
    lines.push(`${scoped.scope}:registry=${scoped.registryUrl}`);
  }

  if (input.authToken && input.authToken.length > 0) {
    const key = registryAuthKey(input.registryUrl);
    lines.push(`${key}:_authToken=${input.authToken}`);
    // Scoped registries on the same host commonly share the token; emit a
    // per-scoped-registry auth line too so private scopes authenticate.
    for (const scoped of input.scopedRegistries) {
      lines.push(`${registryAuthKey(scoped.registryUrl)}:_authToken=${input.authToken}`);
    }
  }

  return lines.join("\n") + "\n";
}
