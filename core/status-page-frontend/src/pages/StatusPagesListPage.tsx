import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PageLayout,
  Button,
  Card,
  Input,
  Label,
  Badge,
  EmptyState,
  LoadingSpinner,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  useToast,
  ConfirmationModal,
} from "@checkstack/ui";
import { Plus, ExternalLink, Trash2, Pencil, MonitorCheck } from "lucide-react";
import {
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import { resolveRoute, extractErrorMessage } from "@checkstack/common";
import {
  StatusPageApi,
  statusPageAccess,
  statusPageRoutes,
  statusPublicRoutes,
} from "@checkstack/status-page-common";
import { TeamOwnershipPicker } from "@checkstack/auth-frontend";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");

export const StatusPagesListPage: React.FC = () => {
  const client = usePluginClient(StatusPageApi);
  const navigate = useNavigate();
  const toast = useToast();
  const accessApi = useApi(accessApiRef);
  const { allowed: canCreateGlobal } = accessApi.useAccess(
    statusPageAccess.page.manage,
  );

  const { data, isLoading } = client.listStatusPages.useQuery({});
  const pages = data?.pages ?? [];

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const createMutation = client.createStatusPage.useMutation({
    onSuccess: (page) => {
      setCreating(false);
      setTitle("");
      setSlug("");
      navigate(resolveRoute(statusPageRoutes.routes.builder, { id: page.id }));
    },
    onError: (e) => setCreateError(extractErrorMessage(e, "Couldn't create page")),
  });
  const deleteMutation = client.deleteStatusPage.useMutation({
    onSuccess: () => {
      toast.success("Status page deleted");
      setDeleteId(null);
    },
    onError: (e) => toast.error(extractErrorMessage(e, "Couldn't delete")),
  });

  return (
    <PageLayout
      title="Status pages"
      icon={MonitorCheck}
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New status page
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : pages.length === 0 ? (
        <EmptyState
          title="No status pages yet"
          description="Build a public page from health, incident, and maintenance widgets."
        />
      ) : (
        <div className="space-y-2">
          {pages.map((page) => (
            <Card
              key={page.id}
              className="flex items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{page.title}</span>
                  {page.published ? (
                    <Badge variant="secondary">Published</Badge>
                  ) : (
                    <Badge variant="outline">Draft</Badge>
                  )}
                  {page.visibility === "authenticated" && (
                    <Badge variant="outline">Internal</Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">/{page.slug}</span>
              </div>
              <div className="flex items-center gap-1">
                {page.published && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      window.open(
                        resolveRoute(statusPublicRoutes.routes.page, {
                          slug: page.slug,
                        }),
                        "_blank",
                      )
                    }
                    aria-label="View public page"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    navigate(
                      resolveRoute(statusPageRoutes.routes.builder, {
                        id: page.id,
                      }),
                    )
                  }
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteId(page.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New status page</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slug) setSlug(slugify(e.target.value));
                }}
                placeholder="Acme Status"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                placeholder="acme"
              />
              <p className="text-xs text-muted-foreground">
                Public URL: /status/{slug || "your-slug"}
              </p>
            </div>
            <TeamOwnershipPicker
              value={teamId}
              onChange={setTeamId}
              allowGlobal={canCreateGlobal}
            />
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              disabled={!title || !slug || createMutation.isPending}
              onClick={() => {
                setCreateError(null);
                createMutation.mutate({
                  title,
                  slug,
                  ...(teamId ? { teamId } : {}),
                });
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationModal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        title="Delete status page?"
        message="This permanently deletes the page and unpublishes it."
        confirmText="Delete"
        variant="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate({ id: deleteId })}
      />
    </PageLayout>
  );
};
