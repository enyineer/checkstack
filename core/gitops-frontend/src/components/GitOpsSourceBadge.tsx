import React from "react";
import { GitBranch, ExternalLink } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@checkstack/ui";
import type { Provenance } from "@checkstack/gitops-common";

interface GitOpsSourceBadgeProps {
  provenance: Provenance;
  iconClassName?: string;
}

/**
 * Badge that signals an entity is GitOps-managed and, on click, surfaces the
 * source repository, file path, and (when derivable) a "View in <provider>"
 * deep link. Used on catalog cards alongside disabled controls so users can
 * jump straight to the file that owns the entity.
 */
export const GitOpsSourceBadge: React.FC<GitOpsSourceBadgeProps> = ({
  provenance,
  iconClassName,
}) => {
  const { repository, filePath, sourceUrl } = provenance;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="View GitOps source"
          title="View GitOps source"
          className="shrink-0 inline-flex items-center justify-center rounded hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 p-0.5"
        >
          <GitBranch
            className={iconClassName ?? "w-4 h-4 text-primary"}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-2 text-sm">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <GitBranch className="w-4 h-4 text-primary shrink-0" />
          Managed by GitOps
        </div>
        <div className="space-y-1 text-xs">
          <div>
            <div className="text-muted-foreground">Repository</div>
            <div className="font-mono text-foreground break-all">
              {repository}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">File</div>
            <div className="font-mono text-foreground break-all">
              {filePath}
            </div>
          </div>
        </div>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View in source provider
          </a>
        ) : (
          <p className="text-xs text-muted-foreground">
            Open this file in your Git provider to make changes.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
};
