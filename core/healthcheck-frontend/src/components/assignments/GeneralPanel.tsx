import React from "react";
import { Button, Checkbox, Label } from "@checkstack/ui";
import { ExternalLink, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { resolveRoute } from "@checkstack/common";
import { healthcheckRoutes } from "@checkstack/healthcheck-common";

interface GeneralPanelProps {
  configurationName: string;
  strategyId: string;
  configurationId: string;
  enabled: boolean;
  onToggleEnabled: () => void;
  onUnassign: () => void;
  saving: boolean;
}

/**
 * Panel showing general assignment info: toggle enabled + link to config editor.
 */
export const GeneralPanel: React.FC<GeneralPanelProps> = ({
  configurationName,
  strategyId,
  configurationId,
  enabled,
  onToggleEnabled,
  onUnassign,
  saving,
}) => {
  const editUrl = resolveRoute(healthcheckRoutes.routes.edit, {
    configId: configurationId,
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
      <div className="p-4 bg-muted/50 rounded-lg border">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={enabled}
            onCheckedChange={onToggleEnabled}
            disabled={saving}
          />
          <div>
            <Label className="text-sm font-medium">Enabled</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              When disabled, this health check will not run for this system
            </p>
          </div>
        </div>
      </div>

      {/* Config Info */}
      <div className="p-4 bg-muted/50 rounded-lg border space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Configuration</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {configurationName}
            </p>
          </div>
          <Link
            to={editUrl}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            Edit configuration
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <div className="text-xs text-muted-foreground">
          Strategy: <code className="bg-muted px-1 py-0.5 rounded text-foreground">{strategyId}</code>
        </div>
      </div>

      {/* Unassign */}
      <div className="pt-2 border-t">
        <Button
          variant="ghost"
          size="sm"
          onClick={onUnassign}
          disabled={saving}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
          Remove Assignment
        </Button>
        <p className="text-xs text-muted-foreground mt-1">
          This will unassign the health check from this system entirely.
        </p>
      </div>
    </div>
  );
};
