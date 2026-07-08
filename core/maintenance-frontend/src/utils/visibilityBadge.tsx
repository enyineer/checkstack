import React from "react";
import { Lock, Eye } from "lucide-react";
import { cn } from "@checkstack/ui";

/**
 * A small chip marking a non-public maintenance update/hotlink. Renders nothing
 * for `public` items (the default) so the timeline/link list stays quiet;
 * `logged_in` and `internal` items get an eye / lock glyph plus a label so the
 * restricted audience reads by icon + words, not color alone.
 *
 * Accepts a plain string so it can be reused as a `renderBadge` callback (which
 * hands back the raw visibility value) without a cast.
 */
export const VisibilityBadge: React.FC<{ visibility: string }> = ({
  visibility,
}) => {
  if (visibility !== "internal" && visibility !== "logged_in") return null;
  const isInternal = visibility === "internal";
  const Icon = isInternal ? Lock : Eye;
  const label = isInternal ? "Internal" : "Logged in";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        isInternal
          ? "bg-status-warn/10 text-status-warn"
          : "bg-status-info/10 text-status-info",
      )}
      title={
        isInternal
          ? "Internal note - visible only to managers"
          : "Visible only to logged-in users"
      }
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
};
