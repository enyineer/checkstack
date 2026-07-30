import type { MentionRef } from "@checkstack/common";
import { extractMentions } from "@checkstack/common";

/**
 * The pure half of PUBLIC mention resolution.
 *
 * A public page resolves a `#` reference to the referenced item's public detail
 * page, and only when this page actually surfaces that item. The gate itself is
 * the backend's; these are the decisions around it, kept testable without
 * React.
 */

/**
 * Every distinct mention anywhere in a rendered value.
 *
 * Walks the value structurally rather than asking each widget to declare its
 * authored fields. Two reasons: the page renders a heterogeneous list of widget
 * DTOs whose shapes the page does not know, and a third-party widget that
 * renders markdown then gets mention resolution without changing the widget
 * contract. Scanning strings that are NOT markdown is harmless - a mention href
 * is specific enough that arbitrary text does not produce one, and a ref that
 * resolves to nothing on this page is simply not linked.
 *
 * Object KEYS are not scanned, only values; keys are field names, never
 * authored content.
 */
export function collectRefsFromValue({
  value,
  limit = 200,
}: {
  value: unknown;
  limit?: number;
}): MentionRef[] {
  const seen = new Set<string>();
  const refs: MentionRef[] = [];

  const visit = (node: unknown): void => {
    if (refs.length >= limit) return;

    if (typeof node === "string") {
      for (const mention of extractMentions({ markdown: node })) {
        const key = `${mention.type}/${mention.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push({ type: mention.type, id: mention.id });
        if (refs.length >= limit) return;
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    if (node && typeof node === "object") {
      for (const item of Object.values(node)) visit(item);
    }
  };

  visit(value);
  return refs;
}

/**
 * The public detail-page kind a mention type maps to, or `undefined` when the
 * type has no public detail page.
 *
 * Only incidents and maintenance windows have one, which is also the complete
 * set of widgets that declare a `mentionType`. A reference to anything else
 * stays plain text - correct, since there would be no public page to send a
 * reader to.
 */
export function toDetailKind({
  type,
}: {
  type: string;
}): "incident" | "maintenance" | undefined {
  if (type === "incident") return "incident";
  if (type === "maintenance") return "maintenance";
  return undefined;
}

/** Stable key for a ref, matching the backend's echo. */
export const publicRefKey = ({ type, id }: MentionRef): string =>
  `${type}/${id}`;

/**
 * Decide the public href for one reference.
 *
 * Every gate must pass: the page must have confirmed it surfaces the target,
 * the type must have a public detail page, and detail linking must be enabled
 * at all (it is not in the builder preview). Failing any of them renders the
 * label as plain text, which is the confidentiality-preserving direction - a
 * dead link would still confirm the referenced item exists.
 */
export function resolvePublicMentionHref({
  ref,
  resolvedKeys,
  buildDetailHref,
}: {
  ref: MentionRef;
  resolvedKeys: Set<string> | undefined;
  buildDetailHref: ((args: {
    kind: "incident" | "maintenance";
    id: string;
  }) => string) | null;
}): string | undefined {
  if (!buildDetailHref) return undefined;
  if (!resolvedKeys?.has(publicRefKey(ref))) return undefined;

  const kind = toDetailKind({ type: ref.type });
  if (!kind) return undefined;

  return buildDetailHref({ kind, id: ref.id });
}
