/**
 * Access-status presentation logic for the API docs browser.
 *
 * Endpoint access is encoded on SECURITY semantics with the colorblind-safe
 * status triad rather than an ad-hoc four-color palette:
 *
 * - externally accessible (public / authenticated) -> `ok`
 * - internal only (user / service)                 -> `warn`
 * - unknown / unmapped                             -> `unknown`
 *
 * The same tone feeds the status pill, its leading dot, the matching icon
 * color, the endpoint card's left accent stripe, and the filter chips, so the
 * signal is multi-encoded (hue + dot + label + stripe position).
 */

export type AccessTone = "ok" | "warn" | "unknown";

/**
 * Map an endpoint's `userType` to a security access tone.
 *
 * `public` and `authenticated` are reachable with an application token, so they
 * read as `ok`. `user` and `service` are internal-only, so they read as `warn`.
 * Anything else (including `undefined`) reads as `unknown`.
 */
export function accessToneForUserType(userType?: string): AccessTone {
  switch (userType) {
    case "public":
    case "authenticated": {
      return "ok";
    }
    case "user":
    case "service": {
      return "warn";
    }
    default: {
      return "unknown";
    }
  }
}

/**
 * Whether an endpoint is reachable via external application tokens.
 */
export function isExternallyAccessible(userType?: string): boolean {
  return userType === "authenticated" || userType === "public";
}
