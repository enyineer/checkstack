import { useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { Bell, Check, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import {
  PageLayout,
  Badge,
  Button,
  Card,
  cn,
  ListEmptyState,
  QueryErrorState,
  Skeleton,
  useToast,
  toastError,
  toastSuccess,
  formatRelativeTime,
  Popover,
  PopoverContent,
  PopoverTrigger,
  DropdownMenuItem,
  MenuCloseContext,
  Markdown,
} from "@checkstack/ui";
import { usePluginClient, useQueryClient } from "@checkstack/frontend-api";
import { NotificationApi } from "@checkstack/notification-common";
import { type InferClient } from "@checkstack/common";
import { NotificationSubjects } from "../components/NotificationSubjects";
import { groupByCollapseKey } from "../components/collapse";
import { CollapsedGroupTimeline } from "../components/CollapsedGroupTimeline";
import { StatusPill } from "../components/StatusPill";
import {
  presentImportance,
  inboxRowAccentTone,
  toneStyles,
} from "../components/notificationDisplay.logic";

/**
 * Cached output of the `notification.getNotifications` query, derived
 * directly from the contract so a future change to the procedure's
 * output shape surfaces as a typecheck error in this file rather than
 * a runtime mismatch between the cache and the optimistic patch.
 */
type NotificationsQueryData = Awaited<
  ReturnType<InferClient<typeof NotificationApi>["getNotifications"]>
>;

export const NotificationsPage = () => {
  const notificationClient = usePluginClient(NotificationApi);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleExpanded = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  const [page, setPage] = useState(0);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const pageSize = 20;

  // Query input — captured once so the loader and the optimistic
  // `markAsRead` patch agree on the exact query-key oRPC builds. Changes
  // to filter/page rebuild the memo, which rebuilds the key, which keeps
  // the optimistic write aimed at the cache entry the user is looking at.
  const notificationsQueryInput = useMemo(
    () => ({
      limit: pageSize,
      offset: page * pageSize,
      unreadOnly: filter === "unread",
    }),
    [page, pageSize, filter],
  );

  // Mirrors oRPC's `generateOperationKey([path], { type, input })` shape;
  // see `docs/frontend/optimistic-updates.md` for the contract.
  const notificationsQueryKey = useMemo(
    () =>
      [
        ["notification", "getNotifications"],
        { input: notificationsQueryInput, type: "query" },
      ] as const,
    [notificationsQueryInput],
  );

  // Query: Fetch notifications
  const notificationsQuery =
    notificationClient.getNotifications.useQuery(notificationsQueryInput);
  const {
    data: notificationsData,
    isLoading: loading,
    refetch,
  } = notificationsQuery;

  const notifications = notificationsData?.items ?? [];
  const total = notificationsData?.total ?? 0;

  // Mutation: Mark as read — optimistic.
  //
  // High-frequency click; the perceived latency win matters. Four-step
  // pattern per `docs/frontend/optimistic-updates.md`:
  // 1. onMutate: cancel in-flight refetches, snapshot, patch.
  // 2. onError: roll back from the snapshot, surface a toast.
  // 3. onSettled: invalidate the exact key so the cache reconciles
  //    with server truth on both branches.
  // 4. No success toast — the row fades; that IS the feedback.
  const markAsReadMutation = notificationClient.markAsRead.useMutation({
    onMutate: async ({ notificationId }) => {
      await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
      const previous =
        queryClient.getQueryData<NotificationsQueryData>(notificationsQueryKey);
      if (previous) {
        queryClient.setQueryData<NotificationsQueryData>(
          notificationsQueryKey,
          {
            ...previous,
            items: previous.items.map((n) =>
              notificationId === undefined || n.id === notificationId
                ? { ...n, isRead: true }
                : n,
            ),
          },
        );
      }
      return { previous };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(notificationsQueryKey, ctx.previous);
      }
      toastError(toast, "Failed to mark as read", error);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
    },
  });

  // Mutation: Delete notification
  const deleteMutation = notificationClient.deleteNotification.useMutation({
    onSuccess: () => {
      void refetch();
      toastSuccess(toast, "Notification deleted");
    },
    onError: (error) => {
      toastError(toast, "Failed to delete notification", error);
    },
  });

  // Mutation: Mark all as read
  const markAllAsReadMutation = notificationClient.markAsRead.useMutation({
    onSuccess: () => {
      void refetch();
      toastSuccess(toast, "All notifications marked as read");
    },
    onError: (error) => {
      toastError(toast, "Failed to mark all as read", error);
    },
  });

  const handleMarkAsRead = (notificationId: string) => {
    markAsReadMutation.mutate({ notificationId });
  };

  const handleDelete = (notificationId: string) => {
    deleteMutation.mutate({ notificationId });
  };

  const handleMarkAllAsRead = () => {
    markAllAsReadMutation.mutate({});
  };

  return (
    <PageLayout title="Notifications" icon={Bell}>
      <div className="space-y-4">
        {/* Number-led summary header: the page's one hero moment. */}
        <div className="flex flex-wrap items-end justify-between gap-4 rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)]">
          <div>
            <p className="leading-none">
              <span className="text-3xl font-bold tabular-nums text-foreground">
                {total}
              </span>{" "}
              <span className="text-xs text-muted-foreground">
                {filter === "unread" ? "unread" : "notifications"}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Popover
              open={filterDropdownOpen}
              onOpenChange={setFilterDropdownOpen}
            >
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  {filter === "all" ? "All" : "Unread"}{" "}
                  <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-1">
                <MenuCloseContext.Provider
                  value={{
                    onClose: () => {
                      setFilterDropdownOpen(false);
                    },
                  }}
                >
                  <DropdownMenuItem
                    onClick={() => {
                      setFilter("all");
                    }}
                  >
                    All notifications
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setFilter("unread");
                    }}
                  >
                    Unread only
                  </DropdownMenuItem>
                </MenuCloseContext.Provider>
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllAsRead}
              disabled={markAllAsReadMutation.isPending}
            >
              <Check className="h-4 w-4 mr-1" /> Mark all read
            </Button>
          </div>
        </div>

        {/* Notifications list */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, index) => (
              <Card key={index} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                  <div className="flex items-center gap-1">
                    <Skeleton className="h-8 w-8" />
                    <Skeleton className="h-8 w-8" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : notificationsQuery.isError ? (
          <QueryErrorState
            error={notificationsQuery.error}
            onRetry={() => void notificationsQuery.refetch()}
            resource="notifications"
          />
        ) : notifications.length === 0 ? (
          <ListEmptyState
            resource="notifications"
            description="You're all caught up. New notifications about systems you're subscribed to will show up here."
            icon={<Bell className="h-10 w-10" />}
          />
        ) : (
          <div className="space-y-2">
            {groupByCollapseKey(notifications).map((group) => {
              const notification = group.representative;
              const isExpanded = expandedGroups.has(group.key);
              const importance = presentImportance({
                importance: notification.importance,
              });
              const accentTone = inboxRowAccentTone({
                importance: notification.importance,
                isRead: notification.isRead,
              });
              return (
                <div key={group.key} className="group relative">
                  <Card className="relative overflow-hidden rounded-[var(--d-card-r)] border border-border/70 bg-gradient-to-b from-surface-2 to-surface p-[var(--d-pad)] shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_10px_30px_-14px_hsl(var(--foreground)/0.12)] transition-all group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-xl">
                    {/* Status accent stripe: importance by position + hue. */}
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 w-1",
                        toneStyles[accentTone].accent,
                      )}
                      aria-hidden
                    />
                    <div className="flex items-start justify-between gap-4 pl-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <StatusPill
                            tone={importance.tone}
                            label={importance.label}
                          />
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(notification.createdAt)}
                          </span>
                          {group.collapsed && (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(group.key)}
                              aria-label={
                                isExpanded
                                  ? "Collapse update history"
                                  : "Show update history"
                              }
                            >
                              <Badge
                                variant="secondary"
                                className="text-[10px] cursor-pointer hover:bg-accent"
                              >
                                +{group.count - 1} updates
                                {isExpanded ? (
                                  <ChevronUp className="ml-0.5 h-3 w-3" />
                                ) : (
                                  <ChevronDown className="ml-0.5 h-3 w-3" />
                                )}
                              </Badge>
                            </button>
                          )}
                        </div>
                        <h3
                          className={cn(
                            "text-sm font-semibold leading-snug",
                            notification.isRead
                              ? "text-muted-foreground"
                              : "text-foreground",
                          )}
                        >
                          {notification.title}
                        </h3>
                        <Markdown
                          size="sm"
                          className="text-muted-foreground mt-1"
                        >
                          {notification.body}
                        </Markdown>
                        {notification.subjects &&
                          notification.subjects.length > 0 && (
                            <NotificationSubjects
                              subjects={notification.subjects}
                              maxVisible={5}
                            />
                          )}
                        {notification.action && (
                          <div className="flex gap-2 mt-2">
                            <Link
                              to={notification.action.url}
                              className="text-sm text-primary hover:text-primary/80"
                            >
                              {notification.action.label}
                            </Link>
                          </div>
                        )}
                        {group.collapsed && isExpanded && (
                          <CollapsedGroupTimeline
                            notifications={group.notifications}
                            variant="page"
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                        {!notification.isRead && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              // Mark every notification in the group as read
                              // so the badge clears in one shot.
                              for (const n of group.notifications) {
                                handleMarkAsRead(n.id);
                              }
                            }}
                            disabled={markAsReadMutation.isPending}
                            title="Mark as read"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            for (const n of group.notifications) {
                              handleDelete(n.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => {
                setPage((p) => p - 1);
              }}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page + 1} of {Math.ceil(total / pageSize)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * pageSize >= total}
              onClick={() => {
                setPage((p) => p + 1);
              }}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </PageLayout>
  );
};
