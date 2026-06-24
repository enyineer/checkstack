/**
 * Server-side injection of the frontend bootstrap blob.
 *
 * The SPA's first paint used to wait on a serial network waterfall: the browser
 * fetched `/api/config` (twice) and `/api/plugins` before React could even
 * decide which bundle to render. By inlining those two NON-USER-SPECIFIC values
 * into the served HTML, the frontend reads them synchronously at boot (see
 * `readBootstrap` in `@checkstack/frontend-api`) and the waterfall collapses to
 * zero round-trips.
 *
 * The per-user session is deliberately NOT inlined: it stays a better-auth
 * fetch so the served HTML never carries user-specific data and can be served
 * without per-user caching concerns.
 */

/** The shape inlined into `window.__CHECKSTACK_BOOTSTRAP__`. Mirrors the
 *  `FrontendBootstrap` interface consumed by `@checkstack/frontend-api`. */
export interface FrontendBootstrap {
  /** Same payload `/api/config` returns: the API/WS base URL, plus an opaque
   *  `publicHost` hint on a custom-domain public host. */
  config: {
    baseUrl: string;
    publicHost?: Record<string, unknown>;
    /** Same-origin path prefixes that render via the lean public bundle. */
    publicPathPrefixes?: string[];
  };
  /** Same payload `/api/plugins` returns: the remote (installed) frontend
   *  plugins to load as Module Federation remotes. Empty on a public host. */
  enabledPlugins: { name: string; path: string }[];
}

/** The global the injected script writes and the frontend reads. */
export const BOOTSTRAP_GLOBAL = "__CHECKSTACK_BOOTSTRAP__";

/**
 * Inject `<script>window.__CHECKSTACK_BOOTSTRAP__ = {...}</script>` into `html`,
 * immediately before the first `<script type="module">` (the app entry) so the
 * global exists before the bundle runs. Falls back to before `</head>`, then to
 * prepending, so a template missing the expected markers still works.
 *
 * Every `<` in the serialized JSON is escaped to `<` so a value can never
 * break out of the script element (e.g. a status-page slug containing the text
 * `</script>`). This is the standard safe-inlining escape; the JSON itself is
 * produced by us from trusted server state, not user input.
 */
export function injectBootstrap({
  html,
  bootstrap,
}: {
  html: string;
  bootstrap: FrontendBootstrap;
}): string {
  // Replace every `<` with its JSON unicode escape so a value can never break
  // out of the <script> element (e.g. a status-page slug containing the text
  // that closes a script tag). The escape is the 6 characters backslash, u, 0,
  // 0, 3, c; the browser's JSON parser decodes it back to `<`. The leading
  // backslash is built via char code (92) to avoid a source-level escape.
  const escapedLessThan = `${String.fromCodePoint(92)}u003c`;
  const json = JSON.stringify(bootstrap).replaceAll("<", escapedLessThan);
  const tag = `<script>window.${BOOTSTRAP_GLOBAL} = ${json};</script>`;

  const moduleScript = html.match(/<script\b[^>]*\btype=["']module["'][^>]*>/i);
  if (moduleScript?.index !== undefined) {
    const at = moduleScript.index;
    return `${html.slice(0, at)}${tag}\n    ${html.slice(at)}`;
  }
  if (html.includes("</head>")) {
    return html.replace("</head>", `  ${tag}\n  </head>`);
  }
  return `${tag}${html}`;
}
