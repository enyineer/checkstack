import { useState, useCallback, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import {
  Badge,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
  Button,
  stripMarkdown,
  useToast,
  useIsMobile,
} from "@checkstack/ui";
import { useApi, usePluginClient } from "@checkstack/frontend-api";
import { resolveRoute } from "@checkstack/common";
import {
  NotificationApi,
  notificationRoutes,
} from "@checkstack/notification-common";
import { NotificationSubjects } from "./NotificationSubjects";
import { groupByCollapseKey, type CollapsedNotification } from "./collapse";
import { CollapsedGroupTimeline } from "./CollapsedGroupTimeline";
import { ChevronDown, ChevronUp } from "lucide-react";
import { authApiRef } from "@checkstack/auth-frontend/api";

export const NotificationBell = () => {
  const authApi = useApi(authApiRef);
  const { data: session, isPending: isAuthLoading } = authApi.useSession();
  const notificationClient = usePluginClient(NotificationApi);
  const toast = useToast();
  const isMobile = useIsMobile();

  const [isOpen, setIsOpen] = useState(false);
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

  // Realtime updates arrive via SignalAutoInvalidator on `[["notification"]]`,
  // so both queries stay fresh without per-component signal handlers.
  const { data: unreadData, isLoading: unreadLoading } =
    notificationClient.getUnreadCount.useQuery(undefined, {
      enabled: !!session,
      staleTime: 30_000,
    });

  const { data: notificationsData, isLoading: notificationsLoading } =
    notificationClient.getNotifications.useQuery(
      { limit: 5, offset: 0, unreadOnly: true },
      {
        enabled: !!session && isOpen,
        staleTime: 30_000,
      },
    );

  const markAsReadMutation = notificationClient.markAsRead.useMutation();

  const unreadCount = unreadData?.count ?? 0;
  const recentNotifications = notificationsData?.notifications ?? [];

  const handleMarkAllAsRead = async () => {
    try {
      await markAsReadMutation.mutateAsync({});
    } catch {
      toast.error("Failed to mark all as read");
    }
  };

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

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

  const trigger = (
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
  );

  const headerActions =
    unreadCount > 0 ? (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={() => {
          void handleMarkAllAsRead();
        }}
      >
        <CheckCheck className="h-3 w-3 mr-1" />
        Mark all read
      </Button>
    ) : undefined;

  const renderItem = (group: CollapsedNotification): ReactNode => {
    const notification = group.representative;
    const isExpanded = expandedGroups.has(group.key);
    return (
      <div
        key={group.key}
        className={`flex flex-col items-start gap-1 px-3 py-2 hover:bg-accent transition-colors ${
          notification.importance === "critical"
            ? "border-l-2 border-l-destructive"
            : notification.importance === "warning"
              ? "border-l-2 border-l-warning"
              : ""
        }`}
      >
        <div className="flex items-center gap-2 w-full">
          <div
            className={`font-medium text-sm flex-1 truncate ${
              notification.importance === "critical"
                ? "text-destructive"
                : notification.importance === "warning"
                  ? "text-warning"
                  : "text-foreground"
            }`}
          >
            {notification.title}
          </div>
          {group.collapsed && (
            <button
              type="button"
              className="inline-flex items-center gap-0.5 shrink-0"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                toggleExpanded(group.key);
              }}
              aria-label={
                isExpanded
                  ? "Collapse update history"
                  : "Show update history"
              }
            >
              <Badge
                variant="secondary"
                className="text-[10px] h-5 cursor-pointer hover:bg-accent"
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
        <div className="text-xs text-muted-foreground line-clamp-2">
          {stripMarkdown(notification.body)}
        </div>
        {notification.subjects && notification.subjects.length > 0 && (
          <NotificationSubjects subjects={notification.subjects} />
        )}
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
        {group.collapsed && isExpanded && (
          <CollapsedGroupTimeline notifications={group.notifications} />
        )}
      </div>
    );
  };

  const collapsedGroups = groupByCollapseKey(recentNotifications);

  const list =
    collapsedGroups.length === 0 ? (
      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
        No unread notifications
      </div>
    ) : (
      <>{collapsedGroups.map((g) => renderItem(g))}</>
    );

  const footer = (
    <Link
      to={resolveRoute(notificationRoutes.routes.home)}
      className="block w-full text-center text-sm text-primary hover:bg-accent transition-colors px-3 py-2"
      onClick={handleClose}
    >
      View all notifications
    </Link>
  );

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          size="full"
          className="flex flex-col p-0"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <SheetHeader className="flex flex-row items-center justify-between gap-2 px-4 py-3 border-b border-border space-y-0">
            <SheetTitle className="text-base">Notifications</SheetTitle>
            <div className="pr-8">{headerActions}</div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">{list}</div>
          <div className="border-t border-border">{footer}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="end"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="font-semibold text-sm">Notifications</span>
          {headerActions}
        </div>
        <div className="max-h-[400px] overflow-y-auto">{list}</div>
        <div className="border-t border-border">{footer}</div>
      </PopoverContent>
    </Popover>
  );
};
