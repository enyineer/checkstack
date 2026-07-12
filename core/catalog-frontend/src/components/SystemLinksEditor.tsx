import React from "react";
import { LinksEditor, useToast, toastError } from "@checkstack/ui";
import {
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import {
  CatalogApi,
  catalogAccess,
  catalogResourceTypes,
} from "@checkstack/catalog-common";

interface Props {
  systemId: string;
}

/**
 * Catalog-specific wrapper around the shared {@link LinksEditor}. Owns the
 * RPC + cache wiring so callers (system editor dialog, detail page sidebar,
 * etc.) just drop in the systemId.
 */
export const SystemLinksEditor: React.FC<Props> = ({ systemId }) => {
  const catalogClient = usePluginClient(CatalogApi);
  const accessApi = useApi(accessApiRef);
  const toast = useToast();

  // Per-RESOURCE verdict (global rule OR a team grant on this system) - a
  // global-only `useAccess` here rendered the editor read-only for
  // team-scoped system managers.
  const { canAccess } = accessApi.useResourceAccess({
    accessRule: catalogAccess.system.manage,
    objectType: catalogResourceTypes.system,
    resourceIds: [systemId],
  });
  const canManage = canAccess(systemId);

  const { data: links = [], refetch } =
    catalogClient.getSystemLinks.useQuery({ systemId });

  const addMutation = catalogClient.addSystemLink.useMutation({
    onSuccess: () => {
      void refetch();
    },
    onError: (error) => {
      toastError(toast, "Failed to add link", error);
    },
  });

  const updateMutation = catalogClient.updateSystemLink.useMutation({
    onSuccess: () => {
      void refetch();
    },
    onError: (error) => {
      toastError(toast, "Failed to update link", error);
    },
  });

  const removeMutation = catalogClient.removeSystemLink.useMutation({
    onSuccess: () => {
      void refetch();
    },
    onError: (error) => {
      toastError(toast, "Failed to remove link", error);
    },
  });

  return (
    <LinksEditor
      // Hosted by the "Manage links" dialog, whose title names the surface.
      hideTitle
      description="Jira boards, ticket tools, dashboards, or any URL related to this system."
      links={links}
      canManage={canManage}
      busy={
        addMutation.isPending ||
        updateMutation.isPending ||
        removeMutation.isPending
      }
      onAdd={async ({ label, url }) => {
        await addMutation.mutateAsync({ systemId, label, url });
      }}
      onEdit={async ({ id, label, url }) => {
        await updateMutation.mutateAsync({ id, systemId, label, url });
      }}
      onRemove={async (link) => {
        await removeMutation.mutateAsync({ id: link.id, systemId });
      }}
    />
  );
};
