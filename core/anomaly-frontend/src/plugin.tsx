import { definePluginMetadata } from "@checkstack/common";
import { FrontendPlugin, createSlotExtension } from "@checkstack/frontend-api";
import { 
  AssignmentIDENodeSlot, 
  AssignmentIDEPanelSlot, 
  HealthCheckConfigIDENodeSlot,
  HealthCheckConfigIDEPanelSlot,
  type AssignmentIDEContext,
  type HealthCheckConfigIDEContext
} from "@checkstack/healthcheck-frontend";
import { SystemStateBadgesSlot, SystemDetailsSlot } from "@checkstack/catalog-common";
import { AnomalyConfigPanel } from "./components/AnomalyConfigPanel";
import { AnomalyTemplatePanel } from "./components/AnomalyTemplatePanel";
import { SystemAnomalyBadge } from "./components/SystemAnomalyBadge";
import { SystemAnomalyWidget } from "./components/SystemAnomalyWidget";
import { IDETreeNode } from "@checkstack/ui";
import { Activity } from "lucide-react";

const pluginMetadata = definePluginMetadata({
  pluginId: "anomaly",
});

export const plugin: FrontendPlugin = {
  metadata: pluginMetadata,
  extensions: [
    createSlotExtension(SystemStateBadgesSlot, {
      id: "anomaly.system-badge",
      component: SystemAnomalyBadge,
    }),
    createSlotExtension(SystemDetailsSlot, {
      id: "anomaly.system-details.widget",
      component: SystemAnomalyWidget,
    }),
    createSlotExtension(HealthCheckConfigIDENodeSlot, {
      id: "anomaly.config-ide.node",
      component: (context: HealthCheckConfigIDEContext) => (
        <IDETreeNode
          nodeId={`anomaly-template:${context.configurationId}`}
          label="Anomaly Defaults"
          icon={Activity}
          selected={context.selectedNode === `anomaly-template:${context.configurationId}`}
          onClick={() => context.onSelectNode(`anomaly-template:${context.configurationId}`)}
        />
      ),
    }),
    createSlotExtension(HealthCheckConfigIDEPanelSlot, {
      id: "anomaly.config-ide.panel",
      component: (context: HealthCheckConfigIDEContext) => {
        if (!context.selectedNode?.startsWith("anomaly-template:")) {
          return <></>;
        }
        return <AnomalyTemplatePanel context={context} />;
      },
    }),
    createSlotExtension(AssignmentIDENodeSlot, {
      id: "anomaly.assignment-ide.node",
      component: (context: AssignmentIDEContext) => (
        <IDETreeNode
          nodeId={`anomaly:${context.configurationId}`}
          label="Anomaly Exceptions"
          icon={Activity}
          selected={context.selectedNode === `anomaly:${context.configurationId}`}
          onClick={() => context.onSelectNode(`anomaly:${context.configurationId}`)}
          indent
        />
      ),
    }),
    createSlotExtension(AssignmentIDEPanelSlot, {
      id: "anomaly.assignment-ide.panel",
      component: (context: AssignmentIDEContext) => {
        if (!context.selectedNode?.startsWith("anomaly:")) {
          return <></>;
        }
        return <AnomalyConfigPanel context={context} />;
      },
    }),
  ],
};
