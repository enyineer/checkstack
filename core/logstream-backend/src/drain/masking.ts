/**
 * Drain preprocessor: mask variable substrings to a single wildcard token class
 * BEFORE the line enters the parse tree, then tokenize on whitespace. Masking is
 * pure and deterministic (no IO) so it is fast and unit-testable in isolation.
 *
 * The mask list runs in a deliberate order (broad/containing patterns first) so
 * a match cannot be re-split by a later, narrower rule: a quoted string that
 * contains a URL, an IP that contains numbers, an ISO timestamp that contains
 * numbers - each collapses to exactly one `<*>`. `<*>` itself contains no digit
 * or hex char, so no later rule ever re-matches an already-masked span.
 */

/** The single wildcard token class every masked value collapses to. */
export const WILDCARD = "<*>";

/**
 * Hard cap on tokens fed to the tree. A pathological multi-KB line would
 * otherwise make similarity scoring O(tokens) per cluster; capping keeps the hot
 * path bounded. Truncated lines still cluster by their prefix (Drain routes on
 * the leading tokens anyway).
 */
export const MAX_TOKENS = 512;

interface MaskRule {
  readonly name: string;
  readonly regex: RegExp;
}

/**
 * Ordered masking rules. ORDER MATTERS - see the module doc. Every regex is
 * global (`g`) so all occurrences on the line are replaced.
 */
const MASK_RULES: readonly MaskRule[] = [
  // Quoted strings first: their contents (which may embed any other pattern)
  // are opaque parameters. Non-greedy, single- and double-quoted.
  { name: "quoted", regex: /"[^"]*"|'[^']*'/g },
  // URLs before email/number so the whole URL is one wildcard.
  { name: "url", regex: /\b(?:https?|ftp|wss?):\/\/[^\s"'<>]+/gi },
  { name: "email", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Bearer/JWT/API-key secrets. A leaked `sk_live_...`, `eyJ...` JWT, or bearer
  // token must NEVER survive into a pattern's `sampleBody`, so a recognized
  // secret collapses to one wildcard before the tree ever sees it. Deliberately
  // conservative - only unambiguous JWT-header shapes and known provider
  // prefixes with a long token body match, so ordinary words are never masked
  // (same spirit as the hex rule's required-digit guard below). Runs before the
  // uuid/number/hex rules so the whole secret is a single `<*>`.
  {
    name: "secret",
    regex: new RegExp(
      [
        // JSON Web Tokens: `eyJ<base64url>.<base64url>.<base64url>` - the header
        // segment is the base64url of `{"...`, so it always starts with `eyJ`.
        String.raw`\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}`,
        // Provider-prefixed API keys / tokens with an unambiguous prefix.
        String.raw`\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}`, // Stripe
        String.raw`\bsk-(?:ant|proj)-[A-Za-z0-9_-]{12,}`, // Anthropic / OpenAI project
        String.raw`\bsk-[A-Za-z0-9]{20,}`, // OpenAI classic
        String.raw`\bgh[pousr]_[A-Za-z0-9]{20,}`, // GitHub PAT / OAuth
        String.raw`\bgithub_pat_[A-Za-z0-9_]{20,}`, // GitHub fine-grained PAT
        String.raw`\bxox[baprs]-[A-Za-z0-9-]{10,}`, // Slack
        String.raw`\bglpat-[A-Za-z0-9_-]{16,}`, // GitLab PAT
        String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`, // AWS access key id
        String.raw`\bckls_[A-Za-z0-9]+_[A-Za-z0-9_-]{16,}`, // Checkstack ingest token
      ].join("|"),
      "g",
    ),
  },
  {
    name: "uuid",
    regex:
      /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  },
  // ISO-8601 timestamps (with `T` or a space separator, optional fractional
  // seconds and offset). Runs before number/hex so the whole stamp is one token.
  {
    name: "isoTimestamp",
    regex:
      /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
  },
  // IPv6 (full + compressed forms) before IPv4/hex/number.
  {
    name: "ipv6",
    regex:
      /(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?:(?::[0-9a-fA-F]{1,4}){1,7}|:))/g,
  },
  // IPv4 with optional :port.
  { name: "ipv4", regex: /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g },
  // Hex tokens >= 4 chars: either `0x`-prefixed, or a >=4 run that contains at
  // least one digit. Requiring a digit avoids masking ordinary words that happen
  // to be all hex letters ("cafe", "face", "faded"); real ids/hashes carry a
  // digit. Runs before the plain-number rule.
  {
    name: "hex",
    regex: /\b0x[0-9a-fA-F]+\b|\b(?=[0-9a-fA-F]*\d)[0-9a-fA-F]{4,}\b/g,
  },
  // Plain numbers: integers, decimals and dotted versions (`1.2.3`). Substring
  // replacement, so `v2` -> `v<*>` and `key=42` -> `key=<*>` keep their static
  // affix while the numeric part becomes a parameter.
  { name: "number", regex: /\d+(?:\.\d+)*/g },
];

/** Replace every masked substring on the line with {@link WILDCARD}. */
export function maskLine({ body }: { body: string }): string {
  let masked = body;
  for (const rule of MASK_RULES) {
    masked = masked.replace(rule.regex, WILDCARD);
  }
  return masked;
}

/**
 * Mask then split on whitespace into the token sequence the Drain tree consumes.
 * Empty tokens are dropped; the sequence is capped at {@link MAX_TOKENS}.
 *
 * This is the CANONICAL tokenizer: its output drives the parse tree and the
 * `sha256(streamId + template)` pattern id, so its behaviour is frozen - do not
 * change it without accepting that every persisted pattern id would shift.
 * {@link maskAndTokenizeAnnotated} is proven to reproduce this exact token
 * sequence (see `masking.test.ts`).
 */
export function maskAndTokenize({ body }: { body: string }): string[] {
  const tokens = maskLine({ body })
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return tokens.length > MAX_TOKENS ? tokens.slice(0, MAX_TOKENS) : tokens;
}

/**
 * One masked token together with the RAW body text it was derived from. For a
 * position masking collapsed (a number, uuid, timestamp, quoted string, ...),
 * `raw` is the original substring while the token is (or contains) `<*>`; for an
 * untouched literal the two are equal.
 */
interface MaskSegment {
  /** The original substring this segment spans. */
  raw: string;
  /** True when masking replaced this span with {@link WILDCARD}. */
  masked: boolean;
}

/**
 * Apply the masking rules to `body` while remembering, for each replaced span,
 * the raw text it consumed. Runs the SAME ordered rules as {@link maskLine} but
 * over a segment list instead of a flat string: a masked segment is opaque to
 * every later rule (exactly as `<*>` is un-re-matchable in the string form), so
 * the resulting masked output is identical to `maskLine` while the raw spans are
 * preserved for wildcard-value extraction.
 */
function segmentMask(body: string): MaskSegment[] {
  let segments: MaskSegment[] = [{ raw: body, masked: false }];
  for (const rule of MASK_RULES) {
    const next: MaskSegment[] = [];
    for (const seg of segments) {
      if (seg.masked) {
        next.push(seg);
        continue;
      }
      let lastIndex = 0;
      rule.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.regex.exec(seg.raw)) !== null) {
        if (match.index > lastIndex) {
          next.push({ raw: seg.raw.slice(lastIndex, match.index), masked: false });
        }
        next.push({ raw: match[0], masked: true });
        lastIndex = match.index + match[0].length;
        // Defensive: a zero-width match would otherwise loop forever.
        if (match[0].length === 0) rule.regex.lastIndex++;
      }
      if (lastIndex < seg.raw.length) {
        next.push({ raw: seg.raw.slice(lastIndex), masked: false });
      }
    }
    segments = next;
  }
  return segments;
}

/**
 * Mask + tokenize like {@link maskAndTokenize}, additionally returning the RAW
 * body text behind each token (`raw[i]` is the un-masked source of `tokens[i]`).
 * Masked spans are atomic - a timestamp with an internal space stays one token
 * whose `raw` carries the whole timestamp. The `tokens` array is guaranteed
 * equal to `maskAndTokenize({ body })` (guarded by an equivalence test), so its
 * indices line up with a matched template's `<*>` positions for wildcard-value
 * extraction.
 */
export function maskAndTokenizeAnnotated({ body }: { body: string }): {
  tokens: string[];
  raw: string[];
} {
  const tokens: string[] = [];
  const raw: string[] = [];
  let curMasked = "";
  let curRaw = "";
  let inToken = false;

  const flush = (): void => {
    if (!inToken) return;
    tokens.push(curMasked);
    raw.push(curRaw);
    curMasked = "";
    curRaw = "";
    inToken = false;
  };

  for (const seg of segmentMask(body)) {
    if (seg.masked) {
      // A masked span emits `<*>` (never whitespace), so it extends the current
      // token; its raw text (which MAY contain whitespace) is kept verbatim.
      curMasked += WILDCARD;
      curRaw += seg.raw;
      inToken = true;
      continue;
    }
    for (const part of seg.raw.split(/(\s+)/)) {
      if (part === "") continue;
      if (/^\s+$/.test(part)) {
        flush();
      } else {
        curMasked += part;
        curRaw += part;
        inToken = true;
      }
    }
  }
  flush();

  if (tokens.length > MAX_TOKENS) {
    return { tokens: tokens.slice(0, MAX_TOKENS), raw: raw.slice(0, MAX_TOKENS) };
  }
  return { tokens, raw };
}
