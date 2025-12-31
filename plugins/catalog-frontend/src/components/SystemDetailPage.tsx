import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useApi, rpcApiRef } from "@checkmate/frontend-api";
import { catalogApiRef, System, Group } from "../api";
import { ExtensionSlot } from "@checkmate/frontend-api";
import { SLOT_SYSTEM_DETAILS } from "@checkmate/common";
import type { NotificationClient } from "@checkmate/notification-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  LoadingSpinner,
  HealthBadge,
  SubscribeButton,
  useToast,
} from "@checkmate/ui";

import {
  ArrowLeft,
  Activity,
  Info,
  Users,
  FileJson,
  Calendar,
} from "lucide-react";

const CATALOG_PLUGIN_ID = "catalog-backend";

export const SystemDetailPage: React.FC = () => {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const catalogApi = useApi(catalogApiRef);
  const rpcApi = useApi(rpcApiRef);
  const notificationApi = rpcApi.forPlugin<NotificationClient>(
    "notification-backend"
  );
  const toast = useToast();

  const [system, setSystem] = useState<System | undefined>();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Subscription state
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);

  // Construct the full group ID for this system
  const getSystemGroupId = useCallback(() => {
    return `${CATALOG_PLUGIN_ID}.system.${systemId}`;
  }, [systemId]);

  useEffect(() => {
    if (!systemId) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    Promise.all([catalogApi.getSystems(), catalogApi.getGroups()])
      .then(([systems, allGroups]) => {
        const foundSystem = systems.find((s) => s.id === systemId);

        if (!foundSystem) {
          setNotFound(true);
          return;
        }

        setSystem(foundSystem);

        // Find groups that contain this system
        const systemGroups = allGroups.filter((group) =>
          group.systemIds?.includes(systemId)
        );
        setGroups(systemGroups);
      })
      .catch((error) => {
        console.error("Error fetching system details:", error);
        setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [systemId, catalogApi]);

  // Check subscription status
  useEffect(() => {
    if (!systemId) return;

    setSubscriptionLoading(true);
    notificationApi
      .getSubscriptions()
      .then((subscriptions) => {
        const groupId = getSystemGroupId();
        const hasSubscription = subscriptions.some(
          (s) => s.groupId === groupId
        );
        setIsSubscribed(hasSubscription);
      })
      .catch((error) => {
        console.error("Failed to check subscription status:", error);
      })
      .finally(() => setSubscriptionLoading(false));
  }, [systemId, notificationApi, getSystemGroupId]);

  const handleSubscribe = async () => {
    setSubscriptionLoading(true);
    try {
      await notificationApi.subscribe({ groupId: getSystemGroupId() });
      setIsSubscribed(true);
      toast.success("Subscribed to system notifications");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to subscribe";
      toast.error(message);
    } finally {
      setSubscriptionLoading(false);
    }
  };

  const handleUnsubscribe = async () => {
    setSubscriptionLoading(true);
    try {
      await notificationApi.unsubscribe({ groupId: getSystemGroupId() });
      setIsSubscribed(false);
      toast.success("Unsubscribed from system notifications");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to unsubscribe";
      toast.error(message);
    } finally {
      setSubscriptionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner />
      </div>
    );
  }

  if (notFound || !system) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>
        <Card className="border-destructive/30 bg-destructive/10">
          <CardContent className="p-12 text-center">
            <h2 className="text-xl font-semibold text-destructive mb-2">
              System Not Found
            </h2>
            <p className="text-destructive-foreground">
              The system you're looking for doesn't exist or has been removed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Placeholder for real metadata if we decide to fetch latest runs here
  const metadata = {
    latency: "N/A",
    lastCheck: "N/A",
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>
      </div>

      {/* System Name with Subscribe Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">{system.name}</h1>
        </div>
        <SubscribeButton
          isSubscribed={isSubscribed}
          onSubscribe={handleSubscribe}
          onUnsubscribe={handleUnsubscribe}
          loading={subscriptionLoading}
        />
      </div>

      {/* Health Overview Card */}
      <Card className="border-border shadow-sm">
        <CardHeader className="border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-semibold">
              Health Overview
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Current Status</p>
              <HealthBadge status={system.status} />
            </div>
            <div className="text-right space-y-1">
              <p className="text-sm text-muted-foreground">Response Time</p>
              <p className="text-2xl font-semibold text-foreground">
                {String(metadata.latency)}
              </p>
            </div>
            <div className="text-right space-y-1">
              <p className="text-sm text-muted-foreground">Last Checked</p>
              <p className="text-base font-medium text-foreground">
                {String(metadata.lastCheck)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Information Card */}
      <Card className="border-border shadow-sm">
        <CardHeader className="border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-semibold">
              System Information
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Description
            </label>
            <p className="mt-1 text-foreground">
              {system.description || "No description provided"}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Owner
            </label>
            <p className="mt-1 text-foreground">
              {system.owner || "Not assigned"}
            </p>
          </div>
          <div className="flex gap-6 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                Created:{" "}
                {new Date(system.createdAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                Updated:{" "}
                {new Date(system.updatedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Groups Card */}
      <Card className="border-border shadow-sm">
        <CardHeader className="border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg font-semibold">
              Member of Groups
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              This system is not part of any groups
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {groups.map((group) => (
                <span
                  key={group.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                >
                  {group.name}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metadata Card */}
      {system.metadata &&
        typeof system.metadata === "object" &&
        Object.keys(system.metadata).length > 0 && (
          <Card className="border-border shadow-sm">
            <CardHeader className="border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <FileJson className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg font-semibold">
                  Metadata
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <pre className="text-sm text-foreground bg-muted/30 p-4 rounded border border-border overflow-x-auto">
                {JSON.stringify(system.metadata, undefined, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

      {/* Extension Slot for System Details */}
      <ExtensionSlot
        id={SLOT_SYSTEM_DETAILS}
        context={{ systemId: system.id }}
      />
    </div>
  );
};
