import React, { useState } from "react";
import {
  useApi,
  accessApiRef,
  ExtensionSlot,
} from "@checkstack/frontend-api";
import { Button } from "@checkstack/ui";
import { Bell } from "lucide-react";
import { useProvenanceLock, GitOpsLockBanner } from "@checkstack/gitops-frontend";
import { healthCheckAccess } from "@checkstack/healthcheck-common";
import { AssignmentIDEPanelSlot } from "../../slots";
import {
  ASSIGNMENT_PICKER_NODE,
  buildAssignmentExtensionNodeId,
  buildAssignmentNodeId,
  type ParsedAssignmentNode,
} from "./assignment-node.logic";
import type { AssignmentEditor } from "../../hooks/useAssignmentEditor";
import { GeneralPanel } from "./GeneralPanel";
import { ThresholdsPanel } from "./ThresholdsPanel";
import { RetentionPanel } from "./RetentionPanel";
import { ExecutionPanel } from "./ExecutionPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { PlatformDefaultsDialog } from "./PlatformDefaultsDialog";
import { AssignToSystemPanel } from "./AssignToSystemPanel";

interface AssignmentPanelsProps {
  configId: string;
  parsedNode: ParsedAssignmentNode;
  editor: AssignmentEditor;
  onSelectNode: (nodeId: string) => void;
  /** Per-system write verdict (assignment writes are system-plane). */
  canManageSystem: (systemId: string) => boolean;
}

/**
 * Panel host for the check editor's Assignment section: dispatches the
 * parsed assignment node to the per-assignment panels (reused unchanged from
 * the former system-centric page), the extension panel slot, or the
 * assign-to-system picker.
 */
export const AssignmentPanels: React.FC<AssignmentPanelsProps> = ({
  configId,
  parsedNode,
  editor,
  onSelectNode,
  canManageSystem,
}) => {
  const accessApi = useApi(accessApiRef);
  const [platformDefaultsOpen, setPlatformDefaultsOpen] = useState(false);

  // Platform notification defaults are an INSTANCE-WIDE write
  // (`setPlatformNotificationDefaults` is deliberately `global: true`), so
  // the editor button is gated on the GLOBAL configuration manage rule.
  const { allowed: canManageDefaults } = accessApi.useAccess(
    healthCheckAccess.configuration.manage,
  );

  const activeSystemId =
    parsedNode.kind === "panel" || parsedNode.kind === "extension"
      ? parsedNode.systemId
      : undefined;

  // Assignment writes are additionally locked when the SYSTEM is
  // GitOps-managed (the backend enforces this via enforceNotGitOpsLocked on
  // every assignment mutation). Lock state is per-system-node here, not
  // page-wide - only the selected node's system needs resolving.
  const { isLocked: systemGitOpsLocked, provenance } = useProvenanceLock({
    kind: "System",
    entityId: activeSystemId,
  });

  if (parsedNode.kind === "picker") {
    return (
      <AssignToSystemPanel
        assignedSystemIds={editor.assignments.map((a) => a.systemId)}
        hasAssignments={editor.assignments.length > 0}
        saving={editor.saving}
        onAssign={(systemId) =>
          editor.assign(systemId, () =>
            onSelectNode(buildAssignmentNodeId({ systemId, panel: "general" })),
          )
        }
      />
    );
  }

  const systemId = parsedNode.systemId;
  const assignment = editor.assignments.find((a) => a.systemId === systemId);
  if (!assignment) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-12">
        This assignment no longer exists.
      </div>
    );
  }

  const readOnly = systemGitOpsLocked || !canManageSystem(systemId);

  const banner = systemGitOpsLocked && provenance && (
    <div className="p-4 pb-0">
      <GitOpsLockBanner provenance={provenance} />
    </div>
  );

  if (parsedNode.kind === "extension") {
    return (
      <>
        {banner}
        <ExtensionSlot
          slot={AssignmentIDEPanelSlot}
          context={{
            systemId,
            configurationId: configId,
            selectedNode: parsedNode.extensionNodeId,
            onSelectNode: (extensionNodeId) =>
              onSelectNode(
                buildAssignmentExtensionNodeId({ systemId, extensionNodeId }),
              ),
            isLocked: readOnly,
          }}
        />
      </>
    );
  }

  switch (parsedNode.panel) {
    case "general": {
      return (
        <>
          {banner}
          <GeneralPanel
            systemId={systemId}
            systemName={assignment.systemName}
            enabled={assignment.enabled}
            onToggleEnabled={() => editor.toggleEnabled(systemId)}
            onUnassign={() =>
              editor.unassign(systemId, () =>
                onSelectNode(ASSIGNMENT_PICKER_NODE),
              )
            }
            saving={editor.saving}
            isLocked={readOnly}
          />
        </>
      );
    }
    case "thresholds": {
      return (
        <>
          {banner}
          <ThresholdsPanel
            thresholds={editor.thresholdsFor(systemId)}
            onChange={(t) => editor.changeThresholds(systemId, t)}
            onSave={() => editor.saveThresholds(systemId)}
            saving={editor.saving}
            isLocked={readOnly}
          />
        </>
      );
    }
    case "retention": {
      return (
        <>
          {banner}
          <RetentionPanel
            data={editor.retentionDataFor(systemId)}
            onFieldChange={(field, value) =>
              editor.changeRetentionField(systemId, field, value)
            }
            onSave={() => editor.saveRetention(systemId)}
            onReset={() => editor.resetRetention(systemId)}
            saving={editor.saving}
            isLocked={readOnly}
          />
        </>
      );
    }
    case "execution": {
      return (
        <>
          {banner}
          <ExecutionPanel
            includeLocal={assignment.includeLocal}
            satelliteIds={assignment.satelliteIds ?? []}
            satellites={editor.satellites}
            onToggleLocal={() => editor.toggleLocal(systemId)}
            onToggleSatellite={(satelliteId) =>
              editor.toggleSatellite(systemId, satelliteId)
            }
            satelliteEnvironmentIds={assignment.satelliteEnvironmentIds ?? {}}
            onSetSatelliteEnvironmentMode={(satelliteId, mode) =>
              editor.setSatelliteEnvironmentMode(systemId, satelliteId, mode)
            }
            onToggleSatelliteEnvironment={(satelliteId, environmentId) =>
              editor.toggleSatelliteEnvironment(
                systemId,
                satelliteId,
                environmentId,
              )
            }
            environmentIds={assignment.environmentIds ?? null}
            environments={editor.systemEnvironments.map((e) => ({
              id: e.id,
              name: e.name,
            }))}
            environmentsSettled={editor.systemEnvironmentsSettled}
            environmentsLoading={editor.systemEnvironmentsLoading}
            onSetEnvironmentMode={(mode) =>
              editor.setEnvironmentMode(systemId, mode)
            }
            onToggleEnvironment={(environmentId) =>
              editor.toggleEnvironment(systemId, environmentId)
            }
            saving={editor.saving}
            isLocked={readOnly}
          />
        </>
      );
    }
    case "notifications": {
      const { policy, isOverridden } = editor.notificationViewFor(systemId);
      return (
        <>
          {banner}
          {canManageDefaults && (
            <div className="flex justify-end p-4 pb-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPlatformDefaultsOpen(true)}
              >
                <Bell className="mr-2 h-4 w-4" />
                Notification defaults
              </Button>
            </div>
          )}
          <NotificationsPanel
            policy={policy}
            onChange={(p) => editor.changeNotificationPolicy(systemId, p)}
            onSave={() => editor.saveNotificationPolicy(systemId)}
            saving={editor.saving}
            isLocked={readOnly}
            isOverridden={isOverridden}
            onOverride={() => editor.overrideForAssignment(systemId)}
            onUseDefaults={() => editor.useDefaultsForAssignment(systemId)}
          />
          <PlatformDefaultsDialog
            open={platformDefaultsOpen}
            onOpenChange={setPlatformDefaultsOpen}
          />
        </>
      );
    }
  }
};
