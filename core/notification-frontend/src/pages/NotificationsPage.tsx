import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Bell, Check, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import {
  PageLayout,
  Badge,
  Button,
  Card,
  ListEmptyState,
  QueryErrorState,
  Skeleton,
  useToast,
  Popover,
  PopoverContent,
  PopoverTrigger,
  DropdownMenuItem,
  MenuCloseContext,
  Markdown,
} from "@checkstack/ui";
import { usePluginClient } from "@checkstack/frontend-api";
import type { Notification } from "@checkstack/notification-common";
import { NotificationApi } from "@checkstack/notification-common";
import { extractErrorMessage } from "@checkstack/common";
import { NotificationSubjects } from "../components/NotificationSubjects";
import { groupByCollapseKey } from "../components/collapse";
import { CollapsedGroupTimeline } from "../components/CollapsedGroupTimeline";

export const NotificationsPage = () => {
  const notificationClient = usePluginClient(NotificationApi);
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

  // Query: Fetch notifications
  const notificationsQuery = notificationClient.getNotifications.useQuery({
    limit: pageSize,
    offset: page * pageSize,
    unreadOnly: filter === "unread",
  });
  const {
    data: notificationsData,
    isLoading: loading,
    refetch,
  } = notificationsQuery;

  const notifications = notificationsData?.notifications ?? [];
  const total = notificationsData?.total ?? 0;

  // Mutation: Mark as read
  const markAsReadMutation = notificationClient.markAsRead.useMutation({
    onSuccess: () => {
      void refetch();
      toast.success("Notification marked as read");
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to mark as read"),
      );
    },
  });

  // Mutation: Delete notification
  const deleteMutation = notificationClient.deleteNotification.useMutation({
    onSuccess: () => {
      void refetch();
      toast.success("Notification deleted");
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to delete notification"),
      );
    },
  });

  // Mutation: Mark all as read
  const markAllAsReadMutation = notificationClient.markAsRead.useMutation({
    onSuccess: () => {
      void refetch();
      toast.success("All notifications marked as read");
    },
    onError: (error) => {
      toast.error(
        extractErrorMessage(error, "Failed to mark all as read"),
      );
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

  const getImportanceBadge = (importance: Notification["importance"]) => {
    switch (importance) {
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
  };

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMins < 1) {
      return "Just now";
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return d.toLocaleDateString();
  };

  return (
    <PageLayout title="Notifications" icon={Bell}>
      <div className="space-y-4">
        {/* Header with filters */}
        <div className="flex items-center justify-between">
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
            <span className="text-sm text-muted-foreground">
              {total} notification{total === 1 ? "" : "s"}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllAsRead}
            disabled={markAllAsReadMutation.isPending}
          >
            <Check className="h-4 w-4 mr-1" /> Mark all read
          </Button>
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
              return (
                <Card
                  key={group.key}
                  className={`p-4 ${
                    notification.isRead ? "" : "border-l-4 border-l-primary"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {getImportanceBadge(notification.importance)}
                        <span className="text-xs text-muted-foreground">
                          {formatDate(notification.createdAt)}
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
                        className={`font-medium ${
                          notification.isRead
                            ? "text-muted-foreground"
                            : "text-foreground"
                        }`}
                      >
                        {notification.title}
                      </h3>
                      <Markdown size="sm" className="text-muted-foreground mt-1">
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
                    <div className="flex items-center gap-1">
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
