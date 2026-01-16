import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  Button,
  stripMarkdown,
} from "@checkstack/ui";
import { useApi, usePluginClient } from "@checkstack/frontend-api";
import { useSignal } from "@checkstack/signal-frontend";
import { resolveRoute } from "@checkstack/common";
import type { Notification } from "@checkstack/notification-common";
import {
  NotificationApi,
  NOTIFICATION_RECEIVED,
  NOTIFICATION_COUNT_CHANGED,
  NOTIFICATION_READ,
  notificationRoutes,
} from "@checkstack/notification-common";
import { authApiRef } from "@checkstack/auth-frontend/api";

export const NotificationBell = () => {
  const authApi = useApi(authApiRef);
  const { data: session, isPending: isAuthLoading } = authApi.useSession();
  const notificationClient = usePluginClient(NotificationApi);

  const [isOpen, setIsOpen] = useState(false);

  // State for real-time updates
  const [signalUnreadCount, setSignalUnreadCount] = useState<
    number | undefined
  >();
  const [signalNotifications, setSignalNotifications] = useState<
    Notification[] | undefined
  >();

  // Fetch unread count via useQuery
  const { data: unreadData, isLoading: unreadLoading } =
    notificationClient.getUnreadCount.useQuery(undefined, {
      enabled: !!session,
      staleTime: 30_000,
    });

  // Fetch recent notifications via useQuery
  const { data: notificationsData, isLoading: notificationsLoading } =
    notificationClient.getNotifications.useQuery(
      { limit: 5, offset: 0, unreadOnly: true },
      {
        enabled: !!session && isOpen,
        staleTime: 30_000,
      }
    );

  // Mark all as read mutation
  const markAsReadMutation = notificationClient.markAsRead.useMutation();

  // Use signal data if available, otherwise use query data
  const unreadCount = signalUnreadCount ?? unreadData?.count ?? 0;
  const recentNotifications =
    signalNotifications ?? notificationsData?.notifications ?? [];

  // ==========================================================================
  // REALTIME SIGNAL SUBSCRIPTIONS (replaces polling)
  // ==========================================================================

  // Handle new notification received
  useSignal(
    NOTIFICATION_RECEIVED,
    useCallback((payload) => {
      // Increment unread count
      setSignalUnreadCount((prev) => (prev ?? 0) + 1);

      // Add to recent notifications if dropdown is open
      setSignalNotifications((prev) => [
        {
          id: payload.id,
          title: payload.title,
          body: payload.body,
          importance: payload.importance,
          userId: "", // Not needed for display
          isRead: false,
          createdAt: new Date(),
        },
        ...(prev ?? []).slice(0, 4), // Keep only 5 items
      ]);
    }, [])
  );

  // Handle count changes from other sources
  useSignal(
    NOTIFICATION_COUNT_CHANGED,
    useCallback((payload) => {
      setSignalUnreadCount(payload.unreadCount);
    }, [])
  );

  // Handle notification marked as read
  useSignal(
    NOTIFICATION_READ,
    useCallback((payload) => {
      if (payload.notificationId) {
        // Single notification marked as read - remove from list
        setSignalNotifications((prev) =>
          (prev ?? []).filter((n) => n.id !== payload.notificationId)
        );
        setSignalUnreadCount((prev) => Math.max(0, (prev ?? 1) - 1));
      } else {
        // All marked as read - clear the list
        setSignalNotifications([]);
        setSignalUnreadCount(0);
      }
    }, [])
  );

  // ==========================================================================

  const handleMarkAllAsRead = async () => {
    try {
      await markAsReadMutation.mutateAsync({});
      setSignalUnreadCount(0);
      setSignalNotifications([]);
    } catch (error) {
      console.error("Failed to mark all as read:", error);
    }
  };

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Hide notification bell for unauthenticated users
  if (isAuthLoading || !session) {
    return;
  }

  const loading = unreadLoading || notificationsLoading;

  if (loading) {
    return (
      <Button variant="ghost" size="icon" className="relative" disabled>
        <Bell className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <Button variant="ghost" size="icon" className="relative group">
          <Bell className="h-5 w-5 transition-transform group-hover:scale-110" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <Badge
                variant="destructive"
                className="relative h-5 min-w-[20px] flex items-center justify-center p-0 text-xs font-bold"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        isOpen={isOpen}
        onClose={handleClose}
        className="w-80"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="font-semibold text-sm">Notifications</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => {
                void handleMarkAllAsRead();
              }}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>

        {/* Notification List */}
        <div className="max-h-[400px] overflow-y-auto">
          {recentNotifications.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No unread notifications
            </div>
          ) : (
            <>
              {recentNotifications.map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  className={`flex flex-col items-start gap-1 px-3 py-2 cursor-pointer ${
                    notification.importance === "critical"
                      ? "border-l-2 border-l-destructive"
                      : notification.importance === "warning"
                      ? "border-l-2 border-l-warning"
                      : ""
                  }`}
                >
                  <div
                    className={`font-medium text-sm ${
                      notification.importance === "critical"
                        ? "text-destructive"
                        : notification.importance === "warning"
                        ? "text-warning"
                        : "text-foreground"
                    }`}
                  >
                    {notification.title}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2">
                    {stripMarkdown(notification.body)}
                  </div>
                  {notification.action && (
                    <div className="flex gap-2 mt-1">
                      <Link
                        to={notification.action.url}
                        className="text-xs text-primary hover:underline"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                        }}
                      >
                        {notification.action.label}
                      </Link>
                    </div>
                  )}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </div>

        <DropdownMenuSeparator />

        {/* Footer */}
        <DropdownMenuItem
          onClick={() => {
            handleClose();
          }}
        >
          <Link
            to={resolveRoute(notificationRoutes.routes.home)}
            className="w-full text-center text-sm text-primary"
          >
            View all notifications
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
