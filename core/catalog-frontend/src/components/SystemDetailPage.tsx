import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  usePluginClient,
  ExtensionSlot,
  useApi,
} from "@checkstack/frontend-api";
import { Group, CatalogApi } from "../api";
import {
  SystemDetailsSlot,
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
  catalogSystemTarget,
} from "@checkstack/catalog-common";
import { NotificationSubscriptionsManager } from "@checkstack/notification-frontend";
import {
  Card,
  CardContent,
  Page,
  PageContent,
  PageLayout,
  LoadingSpinner,
  AccessDenied,
} from "@checkstack/ui";
import { authApiRef } from "@checkstack/auth-frontend/api";

import { Activity, Calendar, Mail, User } from "lucide-react";

export const SystemDetailPage: React.FC = () => {
  const { systemId } = useParams<{ systemId: string }>();
  const catalogClient = usePluginClient(CatalogApi);
  const authApi = useApi(authApiRef);
  const { data: session } = authApi.useSession();

  const [groups, setGroups] = useState<Group[]>([]);
  const [notFound, setNotFound] = useState(false);

  // Fetch system data with useQuery
  const { data: systemsData, isLoading: systemsLoading } =
    catalogClient.getSystems.useQuery({});

  // Fetch groups data with useQuery
  const { data: groupsData, isLoading: groupsLoading } =
    catalogClient.getGroups.useQuery({});

  // Fetch contacts for this system
  const { data: contactsData } = catalogClient.getSystemContacts.useQuery(
    { systemId: systemId ?? "" },
    { enabled: !!systemId },
  );

  // Find the system from the fetched data
  const system = systemsData?.systems.find((s) => s.id === systemId);
  const loading = systemsLoading || groupsLoading;

  // Update not found state
  useEffect(() => {
    if (!systemsLoading && !system && systemId) {
      setNotFound(true);
    }
  }, [system, systemsLoading, systemId]);

  // Update groups that contain this system
  useEffect(() => {
    if (groupsData && systemId) {
      const systemGroups = groupsData.filter((group) =>
        group.systemIds?.includes(systemId),
      );
      setGroups(systemGroups);
    }
  }, [groupsData, systemId]);

  if (loading) {
    return (
      <Page>
        <PageContent>
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        </PageContent>
      </Page>
    );
  }

  if (notFound) {
    return (
      <Page>
        <PageContent>
          <div className="max-w-3xl space-y-6">
            <AccessDenied />
          </div>
        </PageContent>
      </Page>
    );
  }

  // Guard for TypeScript
  if (!system) {
    return;
  }

  const headerActions = (
    <div className="flex items-center gap-2">
      <ExtensionSlot slot={SystemStateBadgesSlot} context={{ system }} />
      {session && (
        <NotificationSubscriptionsManager
          target={catalogSystemTarget}
          resource={{ systemId: system.id, systemName: system.name }}
        />
      )}
    </div>
  );

  return (
    <PageLayout
      title={system.name}
      icon={Activity}
      actions={headerActions}
      loading={false}
      maxWidth="full"
    >
      {/* Alert strip — incidents, maintenances, dependency alerts */}
      <ExtensionSlot slot={SystemDetailsTopSlot} context={{ system }} />

      {/* Two-Column Layout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left Column — Monitoring */}
        <div className="space-y-6 min-w-0">
          <ExtensionSlot slot={SystemDetailsSlot} context={{ system }} />
        </div>

        {/* Right Column — System Context */}
        <Card className="h-fit">
          <CardContent className="p-4 space-y-4">
            {/* System Information */}
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                About
              </h3>
              <p className="text-sm text-foreground">
                {system.description || "No description provided"}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" />
                  Created{" "}
                  {new Date(system.createdAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" />
                  Updated{" "}
                  {new Date(system.updatedAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Contacts */}
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Contacts
              </h3>
              {!contactsData || contactsData.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No contacts assigned
                </p>
              ) : (
                <div className="space-y-1.5">
                  {contactsData.map((contact) => (
                    <div
                      key={contact.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      {contact.type === "user" ? (
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <a
                        href={`mailto:${contact.type === "user" ? contact.userEmail : contact.email}`}
                        className="text-primary hover:underline truncate"
                      >
                        {contact.type === "user"
                          ? (contact.userName ?? contact.userId)
                          : contact.email}
                      </a>
                      {contact.label && (
                        <span className="text-muted-foreground text-xs">
                          ({contact.label})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="h-px bg-border" />

            {/* Groups */}
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Groups
              </h3>
              {groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Not part of any groups
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {groups.map((group) => (
                    <span
                      key={group.id}
                      className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                    >
                      {group.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Metadata (conditional) */}
            {system.metadata &&
              typeof system.metadata === "object" &&
              Object.keys(system.metadata).length > 0 && (
                <>
                  <div className="h-px bg-border" />
                  <div className="space-y-2">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Metadata
                    </h3>
                    <pre className="text-xs text-foreground bg-muted/30 p-3 rounded-md border border-border overflow-x-auto">
                      {JSON.stringify(system.metadata, undefined, 2)}
                    </pre>
                  </div>
                </>
              )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
};
