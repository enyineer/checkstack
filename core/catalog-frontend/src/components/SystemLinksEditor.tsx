import React from "react";
import { LinksEditor, useToast, toastError } from "@checkstack/ui";
import {
  usePluginClient,
  useApi,
  accessApiRef,
} from "@checkstack/frontend-api";
import { CatalogApi, catalogAccess } from "@checkstack/catalog-common";

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

  const { allowed: canManage } = accessApi.useAccess(catalogAccess.system.manage);

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
      title="Additional Links"
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
