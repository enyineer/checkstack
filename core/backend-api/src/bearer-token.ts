/**
 * Shared opaque-bearer extraction used by the OAuth resource-server validate
 * path (auth-backend) and the MCP transport (ai-backend) so the two never
 * drift. A `ck_` API key is NOT an opaque OAuth bearer token (it has its own
 * dedicated auth branch), so it is explicitly excluded here.
 */
export function opaqueBearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ") || header.startsWith("Bearer ck_")) {
    return undefined;
  }
  return header.slice("Bearer ".length);
}
