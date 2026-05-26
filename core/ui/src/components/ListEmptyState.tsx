import React from "react";
import { Inbox } from "lucide-react";
import { EmptyState } from "./EmptyState";

interface ListEmptyStateProps {
  /**
   * The name of the resource type the list would display (e.g. `"checks"`,
   * `"incidents"`). Drives the default `"No {resource} yet"` headline.
   */
  resource: string;
  /**
   * Optional supplemental description rendered beneath the headline.
   */
  description?: React.ReactNode;
  /**
   * Optional action area, typically a primary CTA button such as
   * "Create your first check".
   */
  actions?: React.ReactNode;
  /**
   * Optional icon override. Defaults to the lucide `Inbox` glyph so callers
   * don't have to pick one for every list.
   */
  icon?: React.ReactNode;
}

/**
 * ListEmptyState - the canonical empty state for a list-shaped resource.
 *
 * Thin wrapper around {@link EmptyState} that supplies a consistent
 * "No {resource} yet" headline and a sensible default icon. Use this on
 * any page that renders a list and may have zero items so the UX stays
 * uniform across plugins.
 */
export const ListEmptyState: React.FC<ListEmptyStateProps> = ({
  resource,
  description,
  actions,
  icon,
}) => {
  const resolvedIcon = icon ?? <Inbox className="h-10 w-10" />;

  return (
    <EmptyState
      title={`No ${resource} yet`}
      description={description}
      icon={resolvedIcon}
      actions={actions}
    />
  );
};
