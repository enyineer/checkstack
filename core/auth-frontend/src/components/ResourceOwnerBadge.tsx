import React from "react";
import { Users2, Lock } from "lucide-react";
import type { ResourceOwnership } from "../hooks/useResourcesManagedBy";

export interface ResourceOwnerBadgeProps {
  /** The row's ownership from `useResourcesManagedBy().getOwnership(id)`. */
  ownership: ResourceOwnership | undefined;
}

/**
 * Compact per-row owner pill for management tables (catalog Groups /
 * Environments). Renders NOTHING for an unowned/globally-open resource or while
 * ownership is still loading, so ownerless rows stay clean. Fed by the batched
 * {@link useResourcesManagedBy} hook — never queries on its own, so it is safe
 * to render once per row without an N+1.
 */
export const ResourceOwnerBadge: React.FC<ResourceOwnerBadgeProps> = ({
  ownership,
}) => {
  if (!ownership) return null;
  const { summary, teamNames } = ownership;
  if (summary.kind === "open" || summary.kind === "readonly-grants") {
    return null;
  }
  const isPrivate = summary.kind === "private";
  const label = teamNames.join(", ");
  const Icon = isPrivate ? Lock : Users2;
  const title = isPrivate
    ? `Private to ${label} — only this team can view or change it`
    : `Owned by ${label} — only this team can rename or delete it`;
  return (
    <span
      title={title}
      className="inline-flex max-w-[12rem] items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground"
    >
      <Icon aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </span>
  );
};
