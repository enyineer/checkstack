import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useApi } from "@checkmate/frontend-api";
import { catalogApiRef, System, Group } from "../api";
import { ExtensionSlot } from "@checkmate/frontend-api";
import { SLOT_SYSTEM_DETAILS } from "@checkmate/common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  LoadingSpinner,
  HealthBadge,
} from "@checkmate/ui";

import {
  ArrowLeft,
  Activity,
  Info,
  Users,
  FileJson,
  Calendar,
} from "lucide-react";

// Metadata can be extracted from system.metadata or last runs if needed

export const SystemDetailPage: React.FC = () => {
  const { systemId } = useParams<{ systemId: string }>();
  const navigate = useNavigate();
  const catalogApi = useApi(catalogApiRef);

  const [system, setSystem] = useState<System | undefined>();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-12 text-center">
            <h2 className="text-xl font-semibold text-red-900 mb-2">
              System Not Found
            </h2>
            <p className="text-red-700">
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
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>
      </div>

      {/* System Name */}
      <div className="flex items-center gap-3">
        <Activity className="h-8 w-8 text-indigo-600" />
        <h1 className="text-3xl font-bold text-gray-900">{system.name}</h1>
      </div>

      {/* Health Overview Card */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-gray-600" />
            <CardTitle className="text-lg font-semibold">
              Health Overview
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-gray-600">Current Status</p>
              <HealthBadge status={system.status} />
            </div>
            <div className="text-right space-y-1">
              <p className="text-sm text-gray-600">Response Time</p>
              <p className="text-2xl font-semibold text-gray-900">
                {metadata.latency}
              </p>
            </div>
            <div className="text-right space-y-1">
              <p className="text-sm text-gray-600">Last Checked</p>
              <p className="text-base font-medium text-gray-700">
                {metadata.lastCheck}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Information Card */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-gray-600" />
            <CardTitle className="text-lg font-semibold">
              System Information
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-600">
              Description
            </label>
            <p className="mt-1 text-gray-900">
              {system.description || "No description provided"}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-600">Owner</label>
            <p className="mt-1 text-gray-900">
              {system.owner || "Not assigned"}
            </p>
          </div>
          <div className="flex gap-6 text-sm">
            <div className="flex items-center gap-2 text-gray-600">
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
            <div className="flex items-center gap-2 text-gray-600">
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
      <Card className="border-gray-200 shadow-sm">
        <CardHeader className="border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-gray-600" />
            <CardTitle className="text-lg font-semibold">
              Member of Groups
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {groups.length === 0 ? (
            <p className="text-gray-500 text-sm">
              This system is not part of any groups
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {groups.map((group) => (
                <span
                  key={group.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700"
                >
                  {group.name}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metadata Card */}
      {system.metadata && Object.keys(system.metadata).length > 0 && (
        <Card className="border-gray-200 shadow-sm">
          <CardHeader className="border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-2">
              <FileJson className="h-5 w-5 text-gray-600" />
              <CardTitle className="text-lg font-semibold">Metadata</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <pre className="text-sm text-gray-700 bg-gray-50 p-4 rounded border border-gray-200 overflow-x-auto">
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
