/**
 * Cross-entity references ("mentions") inside authored markdown.
 *
 * ## Why a custom scheme and not a URL
 *
 * An operator writing "see also the database maintenance" wants to point at
 * another record, not at a URL. Pasting a URL is what they do today and it is
 * wrong in three ways: the admin URL is meaningless on a public status page,
 * a status page URL is meaningless in the admin UI, and neither works in an
 * email, which needs an absolute address. One authored string cannot be right
 * in all three places.
 *
 * So a mention stores WHAT it points at, never WHERE:
 *
 * ```text
 * [Database upgrade](checkstack:maintenance/9f1c-...)
 * ```
 *
 * That is an ordinary markdown link, which matters: the label is human-readable
 * in the raw source, existing markdown tooling parses it without changes, and a
 * renderer that knows nothing about mentions still shows the label. Only the
 * HREF is resolved per context - the admin UI resolves it to an app route, a
 * status page to that page's own URL, a notification to an absolute URL.
 *
 * ## Resolution is per-context, and may REFUSE
 *
 * A resolver returning `undefined` means "not linkable here". The renderer then
 * shows the label as plain text rather than a dead link. This is a
 * confidentiality requirement, not a nicety: an internal-only incident
 * referenced from a public status update must not become a link that confirms
 * the incident exists.
 */

/** The URL scheme every mention href uses. */
export const MENTION_SCHEME = "checkstack:";

/** A parsed mention: the kind of record and its id. */
export interface MentionRef {
  /**
   * The referenced record's type, namespaced by its owning plugin - e.g.
   * `incident`, `maintenance`. Matches the key a resolver registers under.
   */
  type: string;
  id: string;
}

/**
 * Type/id characters accepted when parsing.
 *
 * Deliberately strict. Anything that reaches a resolver is used to build a URL,
 * so a permissive parser here would let authored text smuggle path segments or
 * a query string into a generated link.
 */
const SAFE_SEGMENT = /^[\w.-]+$/;

/** Build the href for a mention. */
export function buildMentionHref({ type, id }: MentionRef): string {
  return `${MENTION_SCHEME}${type}/${id}`;
}

/**
 * Parse a mention href, or `undefined` when it is not one.
 *
 * Returns `undefined` rather than throwing: this runs over every link in every
 * rendered document, the vast majority of which are ordinary URLs.
 */
export function parseMentionHref({
  href,
}: {
  href?: string;
}): MentionRef | undefined {
  if (!href || !href.startsWith(MENTION_SCHEME)) return undefined;

  const rest = href.slice(MENTION_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return undefined;

  const type = rest.slice(0, slash);
  const id = rest.slice(slash + 1);
  if (!SAFE_SEGMENT.test(type) || !SAFE_SEGMENT.test(id)) return undefined;

  return { type, id };
}

/** Whether an href is a mention (cheaper than parsing when that is all you need). */
export function isMentionHref({ href }: { href?: string }): boolean {
  return parseMentionHref({ href }) !== undefined;
}

/**
 * Build the markdown a mention is inserted as.
 *
 * The label is sanitised so it cannot break out of the link syntax: an
 * unescaped `]` in a title would otherwise terminate the label early and leave
 * the rest of the title as loose text next to a malformed link.
 */
export function buildMentionMarkdown({
  type,
  id,
  label,
}: MentionRef & { label: string }): string {
  const safeLabel = label
    .replaceAll("[", String.raw`\[`)
    .replaceAll("]", String.raw`\]`);
  return `[${safeLabel}](${buildMentionHref({ type, id })})`;
}

/**
 * Matches a markdown inline link whose href is a mention, capturing the label
 * and the href.
 *
 * Intentionally simple: this is a best-effort index for a UI affordance, not a
 * markdown parser, and a missed reference degrades to "not listed" rather than
 * to anything incorrect. The label allows BACKSLASH-ESCAPED brackets (`\[`,
 * `\]`), which is exactly what `buildMentionMarkdown` writes for a title
 * containing them. A naive `[^\]]*` stops at the first escaped `]` and loses
 * the reference entirely.
 *
 * Built fresh per call: a `g`-flagged regex carries `lastIndex` between uses,
 * so a shared instance would skip matches on every other call.
 */
const mentionLinkPattern = () =>
  /\[((?:\\.|[^\\\]])*)]\(\s*(checkstack:[^\s)]+)\s*\)/g;

/**
 * Whether a resolved URL can be embedded in a markdown link destination
 * without breaking out of it.
 *
 * Whitespace ends the destination and `(`/`)` nest it, so a URL containing
 * either would produce malformed markdown - and, worse, could let a crafted
 * resolver output inject trailing syntax. Resolvers here build URLs from
 * `resolveRoute`, so this should never fire; it exists so that if one ever
 * does, {@link rewriteMentions} fails CLOSED to a plain label.
 */
const isEmbeddableUrl = (url: string) => !/[\s()<>]/.test(url);

/**
 * Rewrite every mention in a markdown document for one delivery context.
 *
 * `resolve` returns the URL a mention should point at here, or `undefined` for
 * "not linkable in this context". An unresolved mention is flattened to its
 * LABEL - the link syntax is removed entirely rather than left pointing at the
 * internal `checkstack:` scheme.
 *
 * That flattening is the whole point. A `checkstack:` href is meaningless
 * outside a renderer that understands it, and different channels leak it
 * differently: an email sanitiser strips the href and leaves a dead `<a>`,
 * while Slack's mrkdwn happily emits `<checkstack:incident/123|Label>` and
 * shows the internal URI to the recipient. Rewriting before the body reaches
 * any channel means no channel has to know the scheme exists.
 *
 * The label is emitted exactly as authored (escapes intact), so a title
 * containing brackets stays literal text and cannot form new markdown syntax.
 */
export function rewriteMentions({
  markdown,
  resolve,
}: {
  markdown: string;
  resolve: (ref: MentionRef) => string | undefined;
}): string {
  return markdown.replaceAll(
    mentionLinkPattern(),
    (whole, rawLabel: string, href: string) => {
      const ref = parseMentionHref({ href });
      // Not a well-formed mention after all - leave the source untouched
      // rather than mangling a link this function does not own.
      if (!ref) return whole;

      const url = resolve(ref);
      if (!url || !isEmbeddableUrl(url)) return rawLabel;

      return `[${rawLabel}](${url})`;
    },
  );
}

/** A mention found in a document, with the label the author gave it. */
export interface ExtractedMention extends MentionRef {
  /**
   * The link text as authored - the referenced record's title at the time of
   * writing. Used as-is for a "referenced items" chip: it needs no lookup, and
   * it is what the author actually saw when they inserted the reference.
   */
  label: string;
}

/**
 * Every mention referenced by a markdown document, de-duplicated, in the order
 * they first appear.
 *
 * Used to derive a "referenced items" list on a detail page WITHOUT storing a
 * second copy of the relationships: the authored text is the single source of
 * truth, so a reference cannot go stale relative to the prose that created it.
 */
export function extractMentions({
  markdown,
}: {
  markdown: string;
}): ExtractedMention[] {
  const found: ExtractedMention[] = [];
  const seen = new Set<string>();

  for (const match of markdown.matchAll(mentionLinkPattern())) {
    const ref = parseMentionHref({ href: match[2] });
    if (!ref) continue;
    const key = `${ref.type}/${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Unescape the brackets `buildMentionMarkdown` escaped on the way in.
    const label = (match[1] ?? "")
      .replaceAll(String.raw`\[`, "[")
      .replaceAll(String.raw`\]`, "]");
    found.push({ ...ref, label });
  }

  return found;
}
