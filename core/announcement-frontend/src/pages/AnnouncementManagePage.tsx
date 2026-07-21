import React, { useState } from "react";
import {
  usePluginClient,
  accessApiRef,
  useApi,
  wrapInSuspense,
} from "@checkstack/frontend-api";
import {
  AnnouncementApi,
  announcementAccess,
  pluginMetadata as announcementPluginMetadata,
  type Announcement,
  type AnnouncementSeverity,
  type AnnouncementVisibility,
  type AnnouncementDisplayMode,
} from "@checkstack/announcement-common";
import { Tip } from "@checkstack/tips-frontend";
import { AnnouncementStatSummary } from "../components/AnnouncementStatSummary";
import { StatusPill, toneStyles } from "../components/StatusPill";
import {
  getAnnouncementStatus,
  severityToTone,
  announcementSeverityRank,
  announcementStatusRank,
} from "../components/announcementStatus.logic";
import {
  announcementFacetIds,
  announcementFacets,
  DISPLAY_MODE_LABELS,
  SEVERITY_LABELS,
  VISIBILITY_LABELS,
} from "../components/announcementFacets";
import {
  PageLayout,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  LoadingSpinner,
  EmptyState,
  QueryErrorState,
  DataTable,
  type DataTableColumn,
  RowActions,
  RowAction,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  useToast,
  useDataTableFilters,
  ConfirmationModal,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Label,
  Textarea,
  toastError,
  cn,
  useSeedFormOnOpen,
} from "@checkstack/ui";
import {
  Plus,
  Megaphone,
  Trash2,
  Edit2,
  Clock,
  Eye,
  EyeOff,
  Monitor,
  LayoutDashboard,
  Columns,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

// ---------------------------------------------------------------------------
// Editor Dialog
// ---------------------------------------------------------------------------

interface AnnouncementEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  announcement?: Announcement;
  onSave: () => void;
}

const AnnouncementEditor: React.FC<AnnouncementEditorProps> = ({
  open,
  onOpenChange,
  announcement,
  onSave,
}) => {
  const announcementClient = usePluginClient(AnnouncementApi);
  const toast = useToast();
  const isEdit = !!announcement;

  const [title, setTitle] = useState(announcement?.title ?? "");
  const [message, setMessage] = useState(announcement?.message ?? "");
  const [severity, setSeverity] = useState<AnnouncementSeverity>(
    announcement?.severity ?? "info",
  );
  const [visibility, setVisibility] = useState<AnnouncementVisibility>(
    announcement?.visibility ?? "all",
  );
  const [displayMode, setDisplayMode] = useState<AnnouncementDisplayMode>(
    announcement?.displayMode ?? "both",
  );
  const [active, setActive] = useState(announcement?.active ?? true);
  const [startsAt, setStartsAt] = useState(
    announcement?.startsAt
      ? format(new Date(announcement.startsAt), "yyyy-MM-dd'T'HH:mm")
      : "",
  );
  const [expiresAt, setExpiresAt] = useState(
    announcement?.expiresAt
      ? format(new Date(announcement.expiresAt), "yyyy-MM-dd'T'HH:mm")
      : "",
  );

  // Reset form once each time the dialog transitions closed -> open, so a
  // background refetch of `announcement` while the dialog stays open doesn't
  // wipe in-progress edits.
  useSeedFormOnOpen(open, () => {
    setTitle(announcement?.title ?? "");
    setMessage(announcement?.message ?? "");
    setSeverity(announcement?.severity ?? "info");
    setVisibility(announcement?.visibility ?? "all");
    setDisplayMode(announcement?.displayMode ?? "both");
    setActive(announcement?.active ?? true);
    setStartsAt(
      announcement?.startsAt
        ? format(new Date(announcement.startsAt), "yyyy-MM-dd'T'HH:mm")
        : "",
    );
    setExpiresAt(
      announcement?.expiresAt
        ? format(new Date(announcement.expiresAt), "yyyy-MM-dd'T'HH:mm")
        : "",
    );
  });

  const createMutation = announcementClient.createAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("Announcement created");
      onOpenChange(false);
      onSave();
    },
    onError: (error) => {
      toastError(toast, "Failed to create announcement", error);
    },
  });

  const updateMutation = announcementClient.updateAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("Announcement updated");
      onOpenChange(false);
      onSave();
    },
    onError: (error) => {
      toastError(toast, "Failed to update announcement", error);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const data = {
      title,
      message,
      severity,
      visibility,
      displayMode,
      active,
      startsAt: startsAt ? new Date(startsAt) : undefined,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
    };

    if (isEdit && announcement) {
      updateMutation.mutate({ id: announcement.id, ...data });
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Announcement" : "Create Announcement"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the announcement details below."
              : "Create a new announcement to display in the portal."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="ann-title">Title</Label>
            <Input
              id="ann-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Announcement title"
              required
            />
          </div>

          {/* Message (Markdown) */}
          <div className="space-y-2">
            <Label htmlFor="ann-message">Message (Markdown)</Label>
            <Textarea
              id="ann-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your announcement message in Markdown..."
              rows={6}
              required
            />
          </div>

          {/* Severity + Visibility + Display Mode row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Severity</Label>
              <Select
                value={severity}
                onValueChange={(v) => setSeverity(v as AnnouncementSeverity)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select
                value={visibility}
                onValueChange={(v) =>
                  setVisibility(v as AnnouncementVisibility)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="authenticated">
                    Authenticated Only
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Display Mode</Label>
              <Select
                value={displayMode}
                onValueChange={(v) =>
                  setDisplayMode(v as AnnouncementDisplayMode)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="banner">Banner Only</SelectItem>
                  <SelectItem value="dashboard">Dashboard Only</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Active toggle + date scheduling */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={active ? "active" : "inactive"}
                onValueChange={(v) => setActive(v === "active")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ann-starts">Starts At (optional)</Label>
              <Input
                id="ann-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ann-expires">Expires At (optional)</Label>
              <Input
                id="ann-expires"
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Saving..."
                : isEdit
                  ? "Update"
                  : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

// ---------------------------------------------------------------------------
// Status / severity badges
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<
  ReturnType<typeof getAnnouncementStatus>,
  string
> = {
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  inactive: "Inactive",
};

/**
 * The lifecycle state, stated in words on a deliberately NEUTRAL pill. Hue on a
 * row belongs to the announcement's SEVERITY (the leading dot / card stripe), so
 * tinting the lifecycle too would put two competing colour scales on one line -
 * and it previously tinted three of the four states grey by accident anyway.
 * The lifecycle keeps its colour in the aggregate stat strip above the table,
 * where each card IS a bucket.
 */
function StatusBadge({ announcement }: { announcement: Announcement }) {
  const status = getAnnouncementStatus(announcement);
  return <StatusPill tone="neutral">{STATUS_LABELS[status]}</StatusPill>;
}

function SeverityBadge({ severity }: { severity: AnnouncementSeverity }) {
  return (
    <StatusPill tone={severityToTone(severity)}>
      {SEVERITY_LABELS[severity]}
    </StatusPill>
  );
}

function DisplayModeIcon({ mode }: { mode: AnnouncementDisplayMode }) {
  switch (mode) {
    case "banner": {
      return (
        <span title={DISPLAY_MODE_LABELS.banner}>
          <Monitor className="h-4 w-4 text-muted-foreground" />
        </span>
      );
    }
    case "dashboard": {
      return (
        <span title={DISPLAY_MODE_LABELS.dashboard}>
          <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
        </span>
      );
    }
    case "both": {
      return (
        <span title={DISPLAY_MODE_LABELS.both}>
          <Columns className="h-4 w-4 text-muted-foreground" />
        </span>
      );
    }
  }
}

function VisibilityIcon({
  visibility,
}: {
  visibility: AnnouncementVisibility;
}) {
  switch (visibility) {
    case "all": {
      return (
        <span title={VISIBILITY_LABELS.all}>
          <Eye className="h-4 w-4 text-muted-foreground" />
        </span>
      );
    }
    case "authenticated": {
      return (
        <span title={VISIBILITY_LABELS.authenticated}>
          <EyeOff className="h-4 w-4 text-muted-foreground" />
        </span>
      );
    }
  }
}

/**
 * The announcement's 1-based position in the operator-defined order, plus the
 * up/down controls that change it. Ends of the list and an in-flight reorder
 * disable the relevant buttons.
 *
 * The position is shown, not just implied by the row's place on screen, because
 * the table is sortable: under a Severity sort the arrows still move the row
 * within the PERSISTED order, and the number is what makes that visible.
 *
 * While a filter hides rows the controls are disabled outright - "move down"
 * would swap with a neighbour the operator cannot see, so the row would appear
 * not to move at all. Same rule as the catalog's Groups tab.
 */
function ReorderControls({
  index,
  count,
  disabled,
  filtered,
  onMove,
}: {
  index: number;
  count: number;
  disabled: boolean;
  filtered: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const filteredTitle = filtered ? "Clear filters to reorder" : undefined;
  return (
    <div className="flex items-center gap-0.5">
      <span className="w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Move up"
        title={filteredTitle ?? "Move up"}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Move down"
        title={filteredTitle ?? "Move down"}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const AnnouncementManageContent: React.FC = () => {
  const announcementClient = usePluginClient(AnnouncementApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  const { allowed: canManage, loading: accessLoading } = accessApi.useAccess(
    announcementAccess.manage,
  );

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<
    Announcement | undefined
  >();
  const [deleteId, setDeleteId] = useState<string | undefined>();

  const announcementsQuery = announcementClient.listAllAnnouncements.useQuery();
  const { data: announcementsData, isLoading, refetch } = announcementsQuery;

  const deleteMutation = announcementClient.deleteAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("Announcement deleted");
      void refetch();
      setDeleteId(undefined);
    },
    onError: (error) => {
      toastError(toast, "Failed to delete announcement", error);
    },
  });

  const reorderMutation = announcementClient.reorderAnnouncements.useMutation({
    onError: (error) => {
      toastError(toast, "Failed to reorder announcements", error);
      // Revert the optimistic order back to the server's source of truth.
      void refetch();
    },
  });

  const announcements = announcementsData?.announcements ?? [];

  // Local, optimistically-ordered copy so the up/down arrows feel instant. It
  // re-syncs whenever the server data changes (create/delete/edit or another
  // operator reordering), so the server stays the source of truth.
  const [orderedAnnouncements, setOrderedAnnouncements] = useState<
    Announcement[]
  >([]);
  // eslint-disable-next-line checkstack/no-state-seed-in-effect -- intentional continuous mirror of the server list so a concurrent operator's reorder stays authoritative; each reorder saves immediately, so there is no unsaved draft to clobber.
  React.useEffect(() => {
    setOrderedAnnouncements(announcementsData?.announcements ?? []);
  }, [announcementsData]);

  const handleMove = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedAnnouncements.length) return;
    const next = [...orderedAnnouncements];
    [next[index], next[target]] = [next[target], next[index]];
    setOrderedAnnouncements(next);
    reorderMutation.mutate({ orderedIds: next.map((a) => a.id) });
  };

  // Fall back to the server list for the first paint before the sync effect
  // runs, so the table never flashes empty.
  const listedAnnouncements =
    orderedAnnouncements.length > 0 ? orderedAnnouncements : announcements;

  // Filter state lives in the URL, so a filtered view is shareable and survives
  // opening an announcement and coming back. The table applies the facets
  // itself; the page only needs to READ the state, to gate reordering.
  const filters = useDataTableFilters({ facetIds: announcementFacetIds });

  // A filter makes "move up/down" ambiguous - the neighbour being swapped with
  // may be off-screen - so reordering is held until the filters are cleared.
  // Same rule as the catalog's Groups tab.
  const reorderDisabled = reorderMutation.isPending || filters.active;

  const handleCreate = () => {
    setEditingAnnouncement(undefined);
    setEditorOpen(true);
  };

  const handleEdit = (a: Announcement) => {
    setEditingAnnouncement(a);
    setEditorOpen(true);
  };

  const handleDelete = () => {
    if (!deleteId) return;
    deleteMutation.mutate({ id: deleteId });
  };

  const handleSave = () => {
    void refetch();
  };

  // Announcement order is operator-controlled (the up/down arrows), and that
  // order is itself the "Order" column: sorting by it restores the persisted
  // order, and a third click on any header returns the table to it too. Every
  // other column sorts independently of it, because each row carries its own
  // canonical position rather than inferring it from its place on screen.
  const indexById = new Map<string, number>();
  for (const [index, a] of listedAnnouncements.entries()) {
    indexById.set(a.id, index);
  }

  const columns: DataTableColumn<Announcement>[] = [
    {
      id: "order",
      header: "Order",
      headClassName: "w-28",
      sortValue: (a) => indexById.get(a.id) ?? 0,
      cell: (a) => {
        const index = indexById.get(a.id) ?? 0;
        return (
          <ReorderControls
            index={index}
            count={listedAnnouncements.length}
            disabled={reorderDisabled}
            filtered={filters.active}
            onMove={(direction) => handleMove(index, direction)}
          />
        );
      },
    },
    {
      id: "title",
      header: "Title",
      sortValue: (a) => a.title,
      searchValue: (a) => a.title,
      cell: (a) => (
        <div className="flex items-center gap-2">
          {/* Severity, not lifecycle: the row's hue answers "how loud is this
              announcement". Its lifecycle is stated in the Status column. */}
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              toneStyles[severityToTone(a.severity)].dot,
            )}
            aria-hidden
          />
          <p className="max-w-xs truncate font-medium text-foreground">
            {a.title}
          </p>
        </div>
      ),
    },
    {
      id: "severity",
      header: "Severity",
      // By impact (critical -> info), not alphabetically.
      sortValue: (a) => announcementSeverityRank[a.severity],
      cell: (a) => <SeverityBadge severity={a.severity} />,
    },
    {
      id: "status",
      header: "Status",
      // By lifecycle (active -> inactive), matching the stat strip's order.
      sortValue: (a) => announcementStatusRank[getAnnouncementStatus(a)],
      cell: (a) => <StatusBadge announcement={a} />,
    },
    {
      id: "display",
      header: "Display",
      // The icon's own caption, so the sort order matches its tooltip.
      sortValue: (a) => DISPLAY_MODE_LABELS[a.displayMode],
      cell: (a) => <DisplayModeIcon mode={a.displayMode} />,
    },
    {
      id: "visibility",
      header: "Visibility",
      sortValue: (a) => VISIBILITY_LABELS[a.visibility],
      cell: (a) => <VisibilityIcon visibility={a.visibility} />,
    },
    {
      id: "created",
      header: "Created",
      // The raw timestamp: the cell shows "3 days ago", which sorts as prose.
      sortValue: (a) => new Date(a.createdAt).getTime(),
      cell: (a) => (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>
            {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
          </span>
        </div>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headClassName: "w-24",
      // The only deliberately unsortable column: an action cluster has no value
      // to order by. Reordering moved out to the "Order" column.
      cell: (a) => (
        <RowActions>
          <RowAction
            icon={Edit2}
            label="Edit announcement"
            onClick={() => handleEdit(a)}
          />
          <RowAction
            icon={Trash2}
            label="Delete announcement"
            tone="destructive"
            onClick={() => setDeleteId(a.id)}
          />
        </RowActions>
      ),
    },
  ];

  return (
    <PageLayout
      title="Announcement Management"
      subtitle="Create and manage portal announcements for your users"
      icon={Megaphone}
      loading={accessLoading}
      allowed={canManage}
      actions={
        <Tip
          plugin={announcementPluginMetadata}
          id="create"
          title="Broadcast portal-wide"
          description="An announcement is a top-of-portal banner - different from incidents (which are about specific systems) and notifications (which target subscribers). Use them for planned maintenance windows users should know about, new feature rollouts, or important policy changes."
          side="bottom"
          align="end"
        >
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Announcement
          </Button>
        </Tip>
      }
    >
      {!isLoading &&
      !announcementsQuery.isError &&
      announcements.length > 0 ? (
        <AnnouncementStatSummary announcements={announcements} />
      ) : null}

      <Card>
        <CardHeader className="border-b border-border">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Announcements</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : announcementsQuery.isError ? (
            <div className="p-4">
              <QueryErrorState
                error={announcementsQuery.error}
                onRetry={() => void announcementsQuery.refetch()}
                resource="announcements"
              />
            </div>
          ) : announcements.length === 0 ? (
            <EmptyState
              icon={<Megaphone className="size-10" />}
              title="No announcements yet"
              description="Announcements appear at the top of the portal and let you broadcast information to anyone using Checkstack - planned downtime, new features, or status updates that don't fit the incident model."
              steps={[
                "Click “New Announcement” and write a short, clear title.",
                "Pick a severity (info, warning, critical) - this controls colour and prominence.",
                "Choose visibility: public, signed-in users only, or specific roles.",
              ]}
              actions={
                <Button onClick={handleCreate}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first announcement
                </Button>
              }
            />
          ) : (
            <DataTable
              data={listedAnnouncements}
              columns={columns}
              getRowId={(a) => a.id}
              // The table owns search + facets; the page only reads the state
              // (from the URL) to gate reordering.
              facets={announcementFacets}
              filters={filters.state}
              onFiltersChange={filters.setState}
              onClearFilters={filters.clear}
              searchPlaceholder="Search titles..."
              // Nested inside the page's opaque Card, so the default bg-card
              // surface would create a panel-in-panel; the enclosing Card
              // already provides the opaque background.
              surface={false}
              // Shown when the facets exclude every row. The "no announcements
              // at all" case is handled above, before the table renders, so this
              // table deliberately declares NO `emptyState` - declaring one
              // would win over this branch once filters empty the row set.
              noResultsState={
                <EmptyState
                  icon={<Megaphone className="size-10" />}
                  title="No announcements match your filters"
                  description="Nothing in this list matches the current search and filter combination."
                  actions={
                    <Button variant="outline" onClick={filters.clear}>
                      Clear filters
                    </Button>
                  }
                />
              }
              getRowProps={() => ({
                className: "transition-colors hover:bg-surface-inset",
              })}
              renderMobileCard={(a) => {
                const index = indexById.get(a.id) ?? 0;
                return (
                  <div className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
                    {/* Severity-toned, matching the desktop row's leading dot. */}
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 w-1",
                        toneStyles[severityToTone(a.severity)].accent,
                      )}
                      aria-hidden
                    />
                    <div className="flex items-start justify-between gap-2 pl-2">
                      <p className="min-w-0 truncate font-medium text-foreground">
                        {a.title}
                      </p>
                      <StatusBadge announcement={a} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-2">
                      <SeverityBadge severity={a.severity} />
                      <DisplayModeIcon mode={a.displayMode} />
                      <VisibilityIcon visibility={a.visibility} />
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(a.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-1 pl-2">
                      <ReorderControls
                        index={index}
                        count={listedAnnouncements.length}
                        disabled={reorderDisabled}
                        filtered={filters.active}
                        onMove={(direction) => handleMove(index, direction)}
                      />
                      <RowActions>
                        <RowAction
                          icon={Edit2}
                          label="Edit announcement"
                          onClick={() => handleEdit(a)}
                        />
                        <RowAction
                          icon={Trash2}
                          label="Delete announcement"
                          tone="destructive"
                          onClick={() => setDeleteId(a.id)}
                        />
                      </RowActions>
                    </div>
                  </div>
                );
              }}
            />
          )}
        </CardContent>
      </Card>

      <AnnouncementEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        announcement={editingAnnouncement}
        onSave={handleSave}
      />

      <ConfirmationModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(undefined)}
        title="Delete Announcement"
        message="Are you sure you want to delete this announcement? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        isLoading={deleteMutation.isPending}
      />
    </PageLayout>
  );
};

export const AnnouncementManagePage = wrapInSuspense(
  AnnouncementManageContent,
);
