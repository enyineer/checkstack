import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Bell, Check, Trash2, ChevronDown } from "lucide-react";
import {
  PageLayout,
  Badge,
  Button,
  Card,
  useToast,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@checkmate/ui";
import { useApi, rpcApiRef } from "@checkmate/frontend-api";
import type {
  Notification,
  NotificationClient,
} from "@checkmate/notification-common";

export const NotificationsPage = () => {
  const rpcApi = useApi(rpcApiRef);
  const notificationClient =
    rpcApi.forPlugin<NotificationClient>("notification");
  const toast = useToast();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(0);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const pageSize = 20;

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      const { notifications: data, total: totalCount } =
        await notificationClient.getNotifications({
          limit: pageSize,
          offset: page * pageSize,
          unreadOnly: filter === "unread",
        });
      setNotifications(data);
      setTotal(totalCount);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to fetch notifications";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [notificationClient, page, filter, toast]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await notificationClient.markAsRead({ notificationId });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
      );
      toast.success("Notification marked as read");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to mark as read";
      toast.error(message);
    }
  };

  const handleDelete = async (notificationId: string) => {
    try {
      await notificationClient.deleteNotification({ notificationId });
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      setTotal((prev) => prev - 1);
      toast.success("Notification deleted");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to delete notification";
      toast.error(message);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationClient.markAsRead({});
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      toast.success("All notifications marked as read");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to mark all as read";
      toast.error(message);
    }
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
    <PageLayout title="Notifications" loading={loading}>
      <div className="space-y-4">
        {/* Header with filters */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                onClick={() => {
                  setFilterDropdownOpen(!filterDropdownOpen);
                }}
              >
                <Button variant="outline" size="sm">
                  {filter === "all" ? "All" : "Unread"}{" "}
                  <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                isOpen={filterDropdownOpen}
                onClose={() => {
                  setFilterDropdownOpen(false);
                }}
              >
                <DropdownMenuItem
                  onClick={() => {
                    setFilter("all");
                    setFilterDropdownOpen(false);
                  }}
                >
                  All notifications
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setFilter("unread");
                    setFilterDropdownOpen(false);
                  }}
                >
                  Unread only
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="text-sm text-muted-foreground">
              {total} notification{total === 1 ? "" : "s"}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void handleMarkAllAsRead();
            }}
          >
            <Check className="h-4 w-4 mr-1" /> Mark all read
          </Button>
        </div>

        {/* Notifications list */}
        {notifications.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No notifications</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {notifications.map((notification) => (
              <Card
                key={notification.id}
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
                    <p className="text-sm text-muted-foreground mt-1">
                      {notification.description}
                    </p>
                    {notification.actions &&
                      notification.actions.length > 0 && (
                        <div className="flex gap-2 mt-2">
                          {notification.actions.map((action, idx) => (
                            <Link
                              key={idx}
                              to={action.href}
                              className={`text-sm ${
                                action.variant === "destructive"
                                  ? "text-destructive hover:text-destructive/80"
                                  : action.variant === "secondary"
                                  ? "text-muted-foreground hover:text-foreground"
                                  : "text-primary hover:text-primary/80"
                              }`}
                            >
                              {action.label}
                            </Link>
                          ))}
                        </div>
                      )}
                  </div>
                  <div className="flex items-center gap-1">
                    {!notification.isRead && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          void handleMarkAsRead(notification.id);
                        }}
                        title="Mark as read"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        void handleDelete(notification.id);
                      }}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
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
