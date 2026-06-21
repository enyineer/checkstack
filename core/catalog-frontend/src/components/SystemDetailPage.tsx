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
  SystemMetaSlot,
  catalogSystemTarget,
} from "@checkstack/catalog-common";
import { NotificationSubscriptionsManager } from "@checkstack/notification-frontend";
import {
  Page,
  PageContent,
  PageLayout,
  LoadingSpinner,
  NotFound,
} from "@checkstack/ui";
import { formatDate } from "../utils/formatDate.logic";
import {
  normalizeMetadata,
  type MetadataEntry,
} from "../utils/normalizeMetadata.logic";
import { authApiRef } from "@checkstack/auth-frontend/api";

import { Activity, Calendar, ExternalLink, Mail, User } from "lucide-react";

const MetadataSection: React.FC<{
  metadata: Record<string, unknown> | null | undefined;
}> = ({ metadata }) => {
  const entries: MetadataEntry[] = normalizeMetadata(metadata);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-border/60 pt-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Metadata
      </h3>
        <dl className="space-y-1.5">
          {entries.map(({ key, displayValue }) => (
            <div key={key} className="flex gap-2 text-xs min-w-0">
              <dt className="shrink-0 font-medium text-muted-foreground">
                {key}
              </dt>
              <dd className="text-foreground truncate">
                <code className="font-mono">{displayValue}</code>
              </dd>
            </div>
          ))}
        </dl>
    </div>
  );
};

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

  // Fetch contacts for this system. Contacts carry PII (name/email), so the
  // endpoint is authenticated-only; skip the request for anonymous viewers
  // (it would 401) and fall back to the "No contacts assigned" empty state.
  const { data: contactsData } = catalogClient.getSystemContacts.useQuery(
    { systemId: systemId ?? "" },
    { enabled: !!systemId && !!session },
  );

  // Fetch additional links for this system
  const { data: linksData } = catalogClient.getSystemLinks.useQuery(
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
          <NotFound message="This system doesn't exist or has been removed." />
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
      <div className="flex items-center gap-1">
        <ExtensionSlot slot={SystemStateBadgesSlot} context={{ system }} />
      </div>
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
        <div className="h-fit space-y-4 rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-4 shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
          {/* System Information */}
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              About
            </h3>
            <p className="text-sm text-foreground">
              {system.description || "No description provided"}
            </p>
            {/* Number-led focal moment: concrete created/updated figures open
                the panel instead of a grey inline run of prose. */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md bg-surface-inset/60 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Calendar className="h-3 w-3" aria-hidden="true" />
                  Created
                </div>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {formatDate(system.createdAt)}
                </p>
              </div>
              <div className="rounded-md bg-surface-inset/60 px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Calendar className="h-3 w-3" aria-hidden="true" />
                  Updated
                </div>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                  {formatDate(system.updatedAt)}
                </p>
              </div>
            </div>
          </div>

          {/* Access — "who can change this" (filled by auth-frontend; renders
              nothing when the system is not team-scoped). */}
          <ExtensionSlot slot={SystemMetaSlot} context={{ system }} />

          {/* Contacts */}
          <div className="space-y-2 border-t border-border/60 pt-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Contacts
            </h3>
            {!contactsData || contactsData.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No contacts assigned
              </p>
            ) : (
              <div className="space-y-0.5">
                {contactsData.map((contact) => (
                  <div
                    key={contact.id}
                    className="-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-sm transition-colors hover:bg-surface-inset"
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

          {/* Additional Links */}
          <div className="space-y-2 border-t border-border/60 pt-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Additional Links
            </h3>
            {!linksData || linksData.length === 0 ? (
              <p className="text-sm text-muted-foreground">No links</p>
            ) : (
              <div className="space-y-0.5">
                {linksData.map((link) => (
                  <div
                    key={link.id}
                    className="-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-sm transition-colors hover:bg-surface-inset"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline truncate"
                    >
                      {link.label ?? link.url}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Groups */}
          <div className="space-y-2 border-t border-border/60 pt-4">
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
                    className="inline-flex items-center rounded-full border border-border/70 bg-surface-inset px-2.5 py-0.5 text-xs font-medium text-foreground"
                  >
                    {group.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Metadata (conditional) */}
          <MetadataSection metadata={system.metadata} />
        </div>
      </div>
    </PageLayout>
  );
};
