import React from "react";
import { GitBranch, ExternalLink } from "lucide-react";
import type { Provenance } from "@checkstack/gitops-common";

interface GitOpsLockBannerProps {
  provenance: Provenance;
}

/**
 * Banner displayed on entity detail pages when the entity is managed by GitOps.
 * Informs the user that manual edits are disabled and shows the Git source.
 */
export const GitOpsLockBanner: React.FC<GitOpsLockBannerProps> = ({
  provenance,
}) => {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/20 bg-primary/5 text-sm">
      <GitBranch className="w-5 h-5 text-primary shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-foreground">
          Managed by GitOps
        </span>
        <span className="text-muted-foreground ml-1">
          - edits are disabled. Changes must be made in Git.
        </span>
        {provenance.sourceUrl ? (
          <a
            href={provenance.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-primary hover:underline mt-0.5 flex items-center gap-1"
          >
            <span className="truncate">
              {provenance.repository}/{provenance.filePath}
            </span>
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        ) : (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {provenance.repository}/{provenance.filePath}
          </div>
        )}
      </div>
    </div>
  );
};
