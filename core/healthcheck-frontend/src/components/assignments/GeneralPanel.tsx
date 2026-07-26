import React from "react";
import { Button, Checkbox, Label } from "@checkstack/ui";
import { ExternalLink, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { resolveRoute } from "@checkstack/common";
import { catalogRoutes } from "@checkstack/catalog-common";

interface GeneralPanelProps {
  systemId: string;
  systemName: string;
  enabled: boolean;
  onToggleEnabled: () => void;
  onUnassign: () => void;
  saving: boolean;
  isLocked?: boolean;
}

/**
 * Panel showing general assignment info: toggle enabled + link to the
 * assigned system. Hosted inside the check editor's Assignment section, so
 * the check side of the pair is already on screen - the system is the
 * context worth linking out to.
 */
export const GeneralPanel: React.FC<GeneralPanelProps> = ({
  systemId,
  systemName,
  enabled,
  onToggleEnabled,
  onUnassign,
  saving,
  isLocked,
}) => {
  const systemUrl = resolveRoute(catalogRoutes.routes.systemDetail, {
    systemId,
  });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">General</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Basic assignment settings for this health check on this system.
        </p>
      </div>

      {/* Enabled Toggle */}
      <div className="p-4 bg-surface-inset rounded-lg border">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={enabled}
            onCheckedChange={onToggleEnabled}
            disabled={saving || isLocked}
          />
          <div>
            <Label className="text-sm font-medium">Enabled</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              When disabled, this health check will not run for this system
            </p>
          </div>
        </div>
      </div>

      {/* System Info */}
      <div className="p-4 bg-surface-inset rounded-lg border">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">System</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {systemName}
            </p>
          </div>
          <Link
            to={systemUrl}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            View system
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Unassign */}
      <div className="pt-2 border-t">
        <Button
          variant="ghost"
          size="sm"
          onClick={onUnassign}
          disabled={saving || isLocked}
          title={isLocked ? "Managed by GitOps or not manageable" : undefined}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Remove Assignment
        </Button>
        <p className="text-xs text-muted-foreground mt-1">
          This will unassign the health check from this system entirely. The
          check stops running there; its configuration is kept.
        </p>
      </div>
    </div>
  );
};
