/**
 * User-guide pages the APP deep-links to (the navbar "Docs" entry and in-context
 * "Learn more" links). Centralised as a SINGLE source of truth and guarded by
 * `docs-links.test.ts`, which asserts each slug resolves to a real docs page -
 * so renaming/moving a doc fails the test instead of silently 404-ing the
 * in-app links.
 *
 * A slug is the path under the docs content root WITHOUT the `/checkstack` base
 * and WITHOUT a trailing slash, e.g. `user-guide/concepts/teams-and-access`.
 */
export const APP_DOC_SLUGS = {
  userGuideHome: "user-guide",
  teamsAndAccess: "user-guide/concepts/teams-and-access",
  apiKeys: "user-guide/reference/api-keys",
} as const;

export type AppDocSlugKey = keyof typeof APP_DOC_SLUGS;

/**
 * Build the same-origin in-app URL for a docs slug. The backend serves the Astro
 * Starlight build at `/checkstack/*` (base path `/checkstack`), and Starlight
 * pages are directory routes, so the URL is `/checkstack/<slug>/` (trailing
 * slash). Pass a value from {@link APP_DOC_SLUGS}.
 */
export function docsPath(slug: string): string {
  return `/checkstack/${slug}/`;
}
