import { lazy, Suspense } from "react";
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
import {
  SystemStateBadgesSlot,
  SystemDetailsSlot,
  SystemSignalsSlot,
  CatalogBrowseDataBoundarySlot,
} from "@checkstack/catalog-common";
import { registerSubscriptionSubControls } from "@checkstack/notification-frontend";
import { anomalySystemSubscription } from "@checkstack/anomaly-common";
import { SystemAnomalyBadge } from "./components/SystemAnomalyBadge";
import { CatalogBrowseAnomalyDataFiller } from "./components/CatalogBrowseAnomalyDataFiller";
import { SystemAnomalyWidget } from "./components/SystemAnomalyWidget";
import { AnomalyFieldMuteList } from "./components/AnomalyFieldMuteList";
import { IDETreeNode } from "@checkstack/ui";
import { Activity } from "lucide-react";

// Heavy IDE panels — lazy-loaded so they stay out of the initial bundle and
// load only when their IDE node is actually selected (the eager guards below
// decide that), not whenever the IDE panel slot renders.
const AnomalyTemplatePanel = lazy(() =>
  import("./components/AnomalyTemplatePanel").then((m) => ({
    default: m.AnomalyTemplatePanel,
  })),
);
const AnomalyConfigPanel = lazy(() =>
  import("./components/AnomalyConfigPanel").then((m) => ({
    default: m.AnomalyConfigPanel,
  })),
);

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
    // Bulk-fills the catalog browse/manage tree so the per-row anomaly badges
    // read an O(1) lookup from context instead of each instantiating two live
    // query observers + scanning the anomaly arrays (the SystemsTab mount cost).
    createSlotExtension(CatalogBrowseDataBoundarySlot, {
      id: "anomaly.catalog.browse-anomaly-data",
      component: CatalogBrowseAnomalyDataFiller,
    }),
    createSlotExtension(SystemSignalsSlot, {
      id: "anomaly.dashboard.signals",
      load: () =>
        import("./components/AnomalySignalsFiller").then((m) => ({
          default: m.AnomalySignalsFiller,
        })),
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
        return (
          <Suspense fallback={null}>
            <AnomalyTemplatePanel context={context} />
          </Suspense>
        );
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
        return (
          <Suspense fallback={null}>
            <AnomalyConfigPanel context={context} />
          </Suspense>
        );
      },
    }),
  ],
};

// Sub-control panel for the per-system anomaly subscription — registered
// once at module load so the notification dialog renders the per-field
// mute list inline below the row when the user expands it. The dialog
// itself is driven by the backend spec registry; no slot extension to
// declare here.
registerSubscriptionSubControls(
  anomalySystemSubscription,
  AnomalyFieldMuteList,
);
