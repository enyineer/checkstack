import React from "react";
import { Link2 } from "lucide-react";
import {
  extractMentions,
  type ExtractedMention,
  type MentionRef,
} from "@checkstack/common";
import { cn } from "../utils";

/** How a resolved reference presents itself. */
export interface ResolvedReference extends MentionRef {
  label: string;
  url: string;
}

export interface ReferencedItemsProps {
  /**
   * Every markdown document to scan - a description plus each update message.
   * The authored text IS the source of truth for references, so nothing is
   * stored twice and a reference can never go stale relative to the prose that
   * created it.
   */
  documents: readonly string[];
  /**
   * Resolve one reference for display, or `undefined` to omit it - an
   * unresolvable or not-permitted reference is left out rather than listed as a
   * dead entry that still confirms the record exists.
   *
   * The reference arrives with the label the AUTHOR wrote, so a resolver
   * usually only has to add a URL.
   */
  resolve: (ref: ExtractedMention) => ResolvedReference | undefined;
  /** Renders the link. Supplied by the host so routing stays its concern. */
  renderLink: (reference: ResolvedReference) => React.ReactNode;
  className?: string;
}

/**
 * "Referenced items": every other record this one's text points at.
 *
 * Derived on read by scanning the authored markdown, deliberately: storing the
 * relationships separately would mean two writers of the same fact, and an
 * edited update that dropped a reference would leave the stored copy behind.
 *
 * Renders nothing when there is nothing to show, so a page that never uses
 * mentions is completely unaffected.
 */
export function ReferencedItems({
  documents,
  resolve,
  renderLink,
  className,
}: ReferencedItemsProps): React.ReactElement {
  const seen = new Set<string>();
  const resolved: ResolvedReference[] = [];

  for (const document of documents) {
    for (const ref of extractMentions({ markdown: document })) {
      const key = `${ref.type}/${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const item = resolve(ref);
      if (item) resolved.push(item);
    }
  }

  if (resolved.length === 0) return <></>;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" />
        <span>Referenced items</span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {resolved.map((reference) => (
          <li key={`${reference.type}/${reference.id}`}>
            {renderLink(reference)}
          </li>
        ))}
      </ul>
    </div>
  );
}
