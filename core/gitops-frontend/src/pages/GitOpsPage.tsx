import { useState } from "react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import { gitopsAccess } from "@checkstack/gitops-common";
import {
  PageLayout,
  Tabs,
  TabPanel,
} from "@checkstack/ui";
import { GitBranch, KeyRound, Activity } from "lucide-react";
import { ProviderList } from "../components/ProviderList";
import { SecretList } from "../components/SecretList";
import { ProvenanceStatus } from "../components/ProvenanceStatus";

const TAB_ITEMS = [
  { id: "providers", label: "Providers", icon: <GitBranch className="w-4 h-4" /> },
  { id: "secrets", label: "Secrets", icon: <KeyRound className="w-4 h-4" /> },
  { id: "status", label: "Sync Status", icon: <Activity className="w-4 h-4" /> },
];

export const GitOpsPage = () => {
  const accessApi = useApi(accessApiRef);
  const [activeTab, setActiveTab] = useState("providers");

  const { allowed: canRead, loading: accessLoading } = accessApi.useAccess(
    gitopsAccess.provider.read,
  );

  return (
    <PageLayout
      title="GitOps"
      subtitle="Manage Git providers, secrets, and sync status for infrastructure-as-code"
      icon={GitBranch}
      loading={accessLoading}
      allowed={canRead}
    >
      <Tabs
        items={TAB_ITEMS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        className="mb-6"
      />

      <TabPanel id="providers" activeTab={activeTab}>
        <ProviderList />
      </TabPanel>

      <TabPanel id="secrets" activeTab={activeTab}>
        <SecretList />
      </TabPanel>

      <TabPanel id="status" activeTab={activeTab}>
        <ProvenanceStatus />
      </TabPanel>
    </PageLayout>
  );
};
