/**
 * Pure helpers for the same-origin public-surface routing decided in `main.tsx`.
 *
 * These deliberately live in the frontend host (NOT `@checkstack/frontend-api`):
 * the entry consumes them before/around Module Federation bootstrap, and keeping
 * them out of the eager-shared `frontend-api` singleton avoids share-proxy churn
 * (a new export on the shared package can leave the dev share module stale).
 */

/**
 * True when `pathname` falls under one of the public path prefixes (an exact
 * match or a `${prefix}/...` child). Used by the SPA entry to decide whether to
 * load the lean public bundle instead of the admin app.
 */
export function isPublicPath(
  pathname: string,
  prefixes: string[] | undefined,
): boolean {
  return (prefixes ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * The trailing segment after the matched public prefix - e.g. the status-page
 * slug in `/statuspage/view/acme`. Returns undefined when no prefix matches or
 * there is no segment after it.
 */
export function publicSlugFromPath(
  pathname: string,
  prefixes: string[] | undefined,
): string | undefined {
  const prefix = (prefixes ?? []).find((p) => pathname.startsWith(`${p}/`));
  if (!prefix) return undefined;
  const segment = pathname.slice(prefix.length + 1).split("/")[0];
  return segment ? decodeURIComponent(segment) : undefined;
}
