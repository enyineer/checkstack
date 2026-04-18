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
  type Announcement,
  type AnnouncementSeverity,
  type AnnouncementVisibility,
  type AnnouncementDisplayMode,
} from "@checkstack/announcement-common";
import {
  PageLayout,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  LoadingSpinner,
  EmptyState,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  useToast,
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
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { extractErrorMessage } from "@checkstack/common";

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

  // Reset form when dialog opens with new data
  React.useEffect(() => {
    if (open) {
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
    }
  }, [open, announcement]);

  const createMutation = announcementClient.createAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("Announcement created");
      onOpenChange(false);
      onSave();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to create"));
    },
  });

  const updateMutation = announcementClient.updateAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("Announcement updated");
      onOpenChange(false);
      onSave();
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to update"));
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
          <div className="grid grid-cols-3 gap-4">
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
          <div className="grid grid-cols-3 gap-4">
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
// Status computation
// ---------------------------------------------------------------------------

function getAnnouncementStatus(
  announcement: Announcement,
): "active" | "scheduled" | "expired" | "inactive" {
  if (!announcement.active) return "inactive";

  const now = new Date();

  if (announcement.startsAt && new Date(announcement.startsAt) > now) {
    return "scheduled";
  }

  if (announcement.expiresAt && new Date(announcement.expiresAt) <= now) {
    return "expired";
  }

  return "active";
}

function StatusBadge({ announcement }: { announcement: Announcement }) {
  const status = getAnnouncementStatus(announcement);

  switch (status) {
    case "active": {
      return <Badge variant="success">Active</Badge>;
    }
    case "scheduled": {
      return <Badge variant="info">Scheduled</Badge>;
    }
    case "expired": {
      return <Badge variant="secondary">Expired</Badge>;
    }
    case "inactive": {
      return <Badge variant="secondary">Inactive</Badge>;
    }
  }
}

function SeverityBadge({ severity }: { severity: AnnouncementSeverity }) {
  switch (severity) {
    case "critical": {
      return <Badge variant="destructive">Critical</Badge>;
    }
    case "warning": {
      return <Badge variant="warning">Warning</Badge>;
    }
    default: {
      return <Badge variant="info">Info</Badge>;
    }
  }
}

function DisplayModeIcon({ mode }: { mode: AnnouncementDisplayMode }) {
  switch (mode) {
    case "banner": {
      return (
        <span title="Banner">
          <Monitor className="h-4 w-4 text-muted-foreground" />
        </span>
      );
    }
    case "dashboard": {
      return (
        <span title="Dashboard">
          <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
        </span>
      );
    }
    case "both": {
      return (
        <span title="Both">
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
        <span title="Everyone">
          <Eye className="h-4 w-4 text-muted-foreground" />
        </span>
      );
    }
    case "authenticated": {
      return (
        <span title="Authenticated only">
          <EyeOff className="h-4 w-4 text-muted-foreground" />
        </span>
      );
    }
  }
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

  const {
    data: announcementsData,
    isLoading,
    refetch,
  } = announcementClient.listAllAnnouncements.useQuery();

  const deleteMutation = announcementClient.deleteAnnouncement.useMutation({
    onSuccess: () => {
      toast.success("Announcement deleted");
      void refetch();
      setDeleteId(undefined);
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to delete"));
    },
  });

  const announcements = announcementsData?.announcements ?? [];

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

  return (
    <PageLayout
      title="Announcement Management"
      subtitle="Create and manage portal announcements for your users"
      icon={Megaphone}
      loading={accessLoading}
      allowed={canManage}
      actions={
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          New Announcement
        </Button>
      }
    >
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
          ) : announcements.length === 0 ? (
            <EmptyState
              title="No announcements yet"
              description="Create your first announcement to inform users about important updates."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Display</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {announcements.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <p className="font-medium truncate max-w-xs">
                        {a.title}
                      </p>
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity={a.severity} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge announcement={a} />
                    </TableCell>
                    <TableCell>
                      <DisplayModeIcon mode={a.displayMode} />
                    </TableCell>
                    <TableCell>
                      <VisibilityIcon visibility={a.visibility} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>
                          {formatDistanceToNow(new Date(a.createdAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(a)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(a.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
