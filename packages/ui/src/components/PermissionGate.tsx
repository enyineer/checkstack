import React from "react";
import { PermissionDenied } from "./PermissionDenied";
import { LoadingSpinner } from "./LoadingSpinner";

/**
 * Props for the PermissionGate component.
 */
export interface PermissionGateProps {
  /**
   * The permission ID to check for access.
   */
  permission: string;
  /**
   * Content to render when permission is granted.
   */
  children: React.ReactNode;
  /**
   * Custom fallback to render when permission is denied.
   * If not provided and showDenied is false, renders nothing.
   */
  fallback?: React.ReactNode;
  /**
   * If true, shows a PermissionDenied component when access is denied.
   * Useful for entire page sections. Overridden by fallback if provided.
   */
  showDenied?: boolean;
  /**
   * Custom message to show in the PermissionDenied component.
   */
  deniedMessage?: string;
  /**
   * Hook to check permissions. Must be provided by the consumer.
   * This allows the component to be used without depending on auth-frontend directly.
   */
  usePermission: (permission: string) => { loading: boolean; allowed: boolean };
}

/**
 * Conditionally renders children based on whether the user has a required permission.
 *
 * @example
 * // Hide content if permission denied
 * <PermissionGate permission="catalog.manage" usePermission={permissionApi.usePermission}>
 *   <ManageButton />
 * </PermissionGate>
 *
 * @example
 * // Show permission denied message
 * <PermissionGate
 *   permission="catalog.read"
 *   usePermission={permissionApi.usePermission}
 *   showDenied
 *   deniedMessage="You don't have access to view the catalog."
 * >
 *   <CatalogList />
 * </PermissionGate>
 *
 * @example
 * // Custom fallback
 * <PermissionGate
 *   permission="admin.manage"
 *   usePermission={permissionApi.usePermission}
 *   fallback={<p>Admin access required</p>}
 * >
 *   <AdminPanel />
 * </PermissionGate>
 */
export const PermissionGate: React.FC<PermissionGateProps> = ({
  permission,
  children,
  fallback,
  showDenied = false,
  deniedMessage,
  usePermission,
}) => {
  const { loading, allowed } = usePermission(permission);

  if (loading) {
    return <LoadingSpinner size="sm" />;
  }

  if (!allowed) {
    if (fallback) {
      return <>{fallback}</>;
    }
    if (showDenied) {
      return (
        <PermissionDenied
          message={deniedMessage ?? `You don't have permission: ${permission}`}
        />
      );
    }
    return <></>;
  }

  return <>{children}</>;
};
