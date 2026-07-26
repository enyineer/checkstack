import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import {
  usePluginClient,
  ExtensionSlot,
  useSlotExtensions,
  useApi,
} from "@checkstack/frontend-api";
import { Group, CatalogApi } from "../api";
import {
  SystemDetailsSlot,
  SystemDetailsTopSlot,
  SystemStateBadgesSlot,
  SystemMetaSlot,
  SystemEditorSlot,
  catalogSystemTarget,
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";
import { NotificationSubscriptionsManager } from "@checkstack/notification-frontend";
import {
  Page,
  PageContent,
  PageLayout,
  LoadingSpinner,
  Skeleton,
  NotFound,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@checkstack/ui";
import { accessApiRef } from "@checkstack/frontend-api";
import {
  useProvenanceLock,
  GitOpsLockBanner,
} from "@checkstack/gitops-frontend";
import { TeamAccessEditor } from "@checkstack/auth-frontend";
import { formatDate } from "../utils/formatDate.logic";
import {
  normalizeMetadata,
  type MetadataEntry,
} from "../utils/normalizeMetadata.logic";
import { ContactsEditor } from "./ContactsEditor";
import { SystemLinksEditor } from "./SystemLinksEditor";
import { authApiRef } from "@checkstack/auth-frontend/api";

import {
  Activity,
  Calendar,
  ExternalLink,
  Mail,
  Pencil,
  User,
} from "lucide-react";

/**
 * Which per-section manage dialog is open. The sidebar itself always renders
 * the compact READ view (identical for every visitor); managers get a small
 * pencil per section that opens a focused, single-purpose dialog - one small
 * form per concern instead of one crammed surface.
 */
type ManageDialog = "contacts" | "links" | "access" | "dependencies";

/** Small pencil affordance shown in a sidebar section header for managers. */
const SectionEditButton: React.FC<{
  label: string;
  onClick: () => void;
}> = ({ label, onClick }) => (
  <Button
    variant="ghost"
    size="icon"
    className="-my-1 h-6 w-6 text-muted-foreground hover:text-foreground"
    onClick={onClick}
    aria-label={label}
    title={label}
  >
    <Pencil className="h-3.5 w-3.5" />
  </Button>
);

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
  const accessApi = useApi(accessApiRef);
  const { data: session } = authApi.useSession();

  // Can the caller manage THIS system (global manage rule OR a team grant on it)?
  // Drives whether the living-data sections render as editors or read-only twins.
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: systemId ? [systemId] : [],
  });
  const canManage = !!systemId && canAccess(systemId);

  // GitOps-managed systems are edited in Git, not here: lock the editors and
  // show the manager a banner explaining why.
  const { isLocked, provenance } = useProvenanceLock({
    kind: "System",
    entityId: systemId,
  });
  const canEdit = canManage && !isLocked;

  const [manageDialog, setManageDialog] = useState<ManageDialog | null>(null);
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

  // ---- Overview cards: reveal together, no staggered pop-in ----------------
  // Every SystemDetailsSlot card self-loads its own data and some self-hide when
  // empty, so left to themselves they appear one after another. Hold the column
  // on a skeleton set until every mounted card has reported settled, then reveal
  // them together (cards with no content simply never appear). Mirrors the
  // dashboard's signal-loading gate.
  const detailFillers = useSlotExtensions(SystemDetailsSlot);
  const expectedDetailCards = detailFillers.length;
  const [reportedCards, setReportedCards] = useState<Set<string>>(new Set());
  const [loadingCards, setLoadingCards] = useState<Set<string>>(new Set());
  const [cardsGraceElapsed, setCardsGraceElapsed] = useState(false);

  const handleCardLoading = useCallback(
    (sourceId: string, isLoading: boolean) => {
      setReportedCards((prev) =>
        prev.has(sourceId) ? prev : new Set(prev).add(sourceId),
      );
      setLoadingCards((prev) => {
        if (isLoading === prev.has(sourceId)) return prev;
        const next = new Set(prev);
        if (isLoading) next.add(sourceId);
        else next.delete(sourceId);
        return next;
      });
    },
    [],
  );

  // Bound the wait so a non-reporting card cannot hold the column forever.
  useEffect(() => {
    if (loading || !system) return;
    const timer = setTimeout(() => setCardsGraceElapsed(true), 8000);
    return () => clearTimeout(timer);
  }, [loading, system]);

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

  // Settled = every mounted card has reported AND none is loading; the grace
  // period bounds a non-reporting card. `system` is guaranteed here.
  const overviewCardsLoading =
    expectedDetailCards > 0 &&
    !cardsGraceElapsed &&
    (reportedCards.size < expectedDetailCards || loadingCards.size > 0);

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

      {/* GitOps lock banner — only a manager who could otherwise edit needs to
          understand why the manage controls are read-only. */}
      {canManage && isLocked && provenance && (
        <GitOpsLockBanner provenance={provenance} />
      )}

      {/* Two-Column Layout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left Column — Monitoring. The cards are kept mounted (so each loads
            and reports) but hidden behind a skeleton set until all have settled,
            then revealed together — no staggered pop-in, no layout shift. */}
        <div className="min-w-0">
          {overviewCardsLoading && (
            <div className="space-y-6" aria-hidden="true">
              <Skeleton variant="card" />
              <Skeleton variant="card" />
              <Skeleton variant="card" />
            </div>
          )}
          <div className={overviewCardsLoading ? "hidden" : "space-y-6"}>
            <ExtensionSlot
              slot={SystemDetailsSlot}
              context={{ system, onLoadingChange: handleCardLoading }}
            />
          </div>
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

          {/* Contacts — the compact read view for EVERYONE; managers of an
              unlocked system get a pencil opening the focused manage dialog. */}
          <div className="space-y-2 border-t border-border/60 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Contacts
              </h3>
              {canEdit && (
                <SectionEditButton
                  label="Manage contacts"
                  onClick={() => setManageDialog("contacts")}
                />
              )}
            </div>
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

          {/* Additional Links — read view for everyone; pencil for managers. */}
          <div className="space-y-2 border-t border-border/60 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Additional Links
              </h3>
              {canEdit && (
                <SectionEditButton
                  label="Manage links"
                  onClick={() => setManageDialog("links")}
                />
              )}
            </div>
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

          {/* Team Access — the read-only "who can change this" summary above
              (SystemMetaSlot) serves everyone; managers additionally get a
              pencil opening the grant editor. Grants are not GitOps-managed,
              so this stays available on locked systems. */}
          {canManage && (
            <div className="space-y-1 border-t border-border/60 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Team Access
                </h3>
                <SectionEditButton
                  label="Manage team access"
                  onClick={() => setManageDialog("access")}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Grant teams view or manage access to this system.
              </p>
            </div>
          )}

          {/* Plugin-contributed configuration (e.g. dependencies) — managed in
              a focused dialog; the read views live in the main column. */}
          {canManage && (
            <div className="space-y-1 border-t border-border/60 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Dependencies
                </h3>
                <SectionEditButton
                  label="Manage dependencies"
                  onClick={() => setManageDialog("dependencies")}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Model what this system depends on and what depends on it.
              </p>
            </div>
          )}

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

      {/* Focused per-section manage dialogs. Each hosts exactly ONE
          self-persisting editor - a small modal per concern instead of one
          crammed surface. Edits invalidate the catalog queries automatically,
          so the read sections behind the dialog stay current. */}
      <Dialog
        open={manageDialog === "contacts"}
        onOpenChange={(open) => !open && setManageDialog(null)}
      >
        <DialogContent size="default">
          <DialogHeader>
            <DialogTitle>Manage contacts</DialogTitle>
            <DialogDescription>
              People and mailboxes to reach about {system.name}.
            </DialogDescription>
          </DialogHeader>
          <ContactsEditor systemId={system.id} />
        </DialogContent>
      </Dialog>

      <Dialog
        open={manageDialog === "links"}
        onOpenChange={(open) => !open && setManageDialog(null)}
      >
        <DialogContent size="default">
          <DialogHeader>
            <DialogTitle>Manage links</DialogTitle>
          </DialogHeader>
          <SystemLinksEditor systemId={system.id} />
        </DialogContent>
      </Dialog>

      <Dialog
        open={manageDialog === "access"}
        onOpenChange={(open) => !open && setManageDialog(null)}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Team access</DialogTitle>
            <DialogDescription>
              Teams granted here can view {system.name}; ticking Manage also
              lets them change it.
            </DialogDescription>
          </DialogHeader>
          <TeamAccessEditor
            resourceType={catalogResourceTypes.system}
            resourceId={system.id}
            compact
            expanded
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={manageDialog === "dependencies"}
        onOpenChange={(open) => !open && setManageDialog(null)}
      >
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Manage dependencies</DialogTitle>
          </DialogHeader>
          <ExtensionSlot
            slot={SystemEditorSlot}
            context={{ systemId: system.id }}
          />
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
};
