/**
 * NO-SECRET-LEAK content scrubber (Phase 6) — makes the previously-architectural
 * guarantee an ENFORCED, tested invariant on the message write path.
 *
 * `ai_messages.content` (and the replay `modelMessages`) is a free-form JSON bag.
 * Architecturally, a provider credential should never reach it — the model only
 * ever sees tool RESULTS (which source procedures redact) and never the
 * integration apiKey. But "should never" is not "cannot": nothing structurally
 * stopped a buggy tool result, a future feature, or a malicious tool from
 * persisting a secret into the bag. This scrubber closes that gap by running on
 * EVERY message write (`appendMessage`), so a credential can never be persisted
 * into message content even if upstream code is wrong.
 *
 * The scrub is deliberately conservative — it redacts:
 *  - any value under a SECRET-SHAPED KEY (apiKey, api_key, authorization, token,
 *    password, secret, x-secret, bearer, ...), recursively; and
 *  - any string VALUE that matches a high-confidence credential pattern
 *    (OpenAI-style `sk-...`, `Bearer <token>` headers), regardless of its key.
 *
 * It does NOT blanket-scrub arbitrary strings: a user's chat text or an
 * incident title that merely contains the word "token" is preserved. The
 * guarantee is "a credential cannot be persisted", not "no string is ever
 * touched".
 */

/** The sentinel a redacted value is replaced with. */
export const REDACTED = "[REDACTED]";

/**
 * Key names whose VALUE is treated as a credential and redacted wholesale
 * (case-insensitive, matched as a substring of the normalized key). These mirror
 * the `x-secret` field names the integration platform stores in the Vault.
 */
const SECRET_KEY_PATTERNS = [
  "apikey",
  "api-key",
  "api_key",
  "secret",
  "password",
  "passwd",
  "authorization",
  "auth-token",
  "authtoken",
  "access-token",
  "accesstoken",
  "access_token",
  "refresh-token",
  "refreshtoken",
  "refresh_token",
  "bearer",
  "x-api-key",
  "private-key",
  "privatekey",
  "private_key",
  "client-secret",
  "clientsecret",
  "client_secret",
  "credential",
];

/**
 * A standalone-token delimiter: whitespace, quotes, comma/semicolon, or string
 * start/end. Deliberately EXCLUDES `/` and other path characters so a
 * token-shaped slug embedded in a URL path (e.g.
 * `https://host/api/sk-checkout-flow-12345678`) is NOT treated as a credential —
 * the key-based redaction (apiKey / authorization / x-secret / ...) remains the
 * primary defense for structured fields, so the value pattern can safely err
 * toward fewer false positives in free text.
 */
const TOKEN_BOUNDARY = String.raw`(?:^|[\s"'\`,;])`;
const TOKEN_BOUNDARY_END = String.raw`(?:$|[\s"'\`,;])`;

/**
 * Value patterns redacted regardless of their key (high-confidence credential
 * shapes only, to avoid scrubbing innocent prose):
 *  - OpenAI-style keys: `sk-...`, `sk-proj-...`, `rk-...` (>= 16 trailing chars)
 *    ONLY when they are a standalone, boundary-delimited token (or the whole
 *    value) — never when embedded inside a longer URL/path.
 *  - An `Authorization: Bearer <token>` header value (the `Bearer ` prefix is
 *    itself a strong signal, so no extra boundary constraint is needed).
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  new RegExp(
    `${TOKEN_BOUNDARY}(?:sk|rk)-(?:proj-)?[A-Za-z0-9_-]{16,}${TOKEN_BOUNDARY_END}`,
  ),
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b/i,
];

/** True if a key name looks like it holds a credential. */
function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/\s+/g, "");
  return SECRET_KEY_PATTERNS.some((p) => normalized.includes(p));
}

/** True if a string value matches a high-confidence credential pattern. */
function valueLooksSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((re) => re.test(value));
}

/**
 * Recursively scrub a JSON-serializable value. Cycles are guarded with a seen
 * set (defensive — message content is already JSON, but a hand-built object
 * could contain a cycle). The input is never mutated; a fresh structure is
 * returned.
 */
function scrubValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return valueLooksSecret(value) ? REDACTED : value;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) return REDACTED;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      // A secret-shaped key: redact the whole subtree, never persist its value.
      out[key] = REDACTED;
      continue;
    }
    out[key] = scrubValue(child, seen);
  }
  return out;
}

/**
 * Scrub a message-content bag before it is persisted. Returns a new record with
 * every credential-shaped key/value redacted. Safe to call on already-clean
 * content (idempotent — re-running over `[REDACTED]` is a no-op).
 */
export function scrubContent(
  content: Record<string, unknown>,
): Record<string, unknown> {
  return scrubValue(content, new WeakSet()) as Record<string, unknown>;
}

/**
 * Scrub the replay `modelMessages` array (AI-SDK `ResponseMessage[]`). Each
 * element is a JSON object; the same recursive scrub applies so a tool-result
 * part can never carry a credential into the replay history.
 */
export function scrubModelMessages(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return messages.map(
    (m) => scrubValue(m, new WeakSet()) as Record<string, unknown>,
  );
}
