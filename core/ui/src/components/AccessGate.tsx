import React from "react";
import { AccessDenied } from "./AccessDenied";
import { LoadingSpinner } from "./LoadingSpinner";

/**
 * Props for the AccessGate component.
 */
export interface AccessGateProps {
  /**
   * The access rule ID to check for access.
   */
  accessRuleId: string;
  /**
   * Content to render when access is granted.
   */
  children: React.ReactNode;
  /**
   * Custom fallback to render when access is denied.
   * If not provided and showDenied is false, renders nothing.
   */
  fallback?: React.ReactNode;
  /**
   * If true, shows a AccessDenied component when access is denied.
   * Useful for entire page sections. Overridden by fallback if provided.
   */
  showDenied?: boolean;
  /**
   * Custom message to show in the AccessDenied component.
   */
  deniedMessage?: string;
  /**
   * Hook to check access. Must be provided by the consumer.
   * This allows the component to be used without depending on auth-frontend directly.
   */
  useAccess: (accessRuleId: string) => { loading: boolean; allowed: boolean };
}

/**
 * Conditionally renders children based on whether the user has a required access rule.
 *
 * @example
 * // Hide content if access denied
 * <AccessGate accessRuleId="catalog.manage" useAccess={accessApi.useAccess}>
 *   <ManageButton />
 * </AccessGate>
 *
 * @example
 * // Show access denied message
 * <AccessGate
 *   accessRuleId="catalog.read"
 *   useAccess={accessApi.useAccess}
 *   showDenied
 *   deniedMessage="You don't have access to view the catalog."
 * >
 *   <CatalogList />
 * </AccessGate>
 *
 * @example
 * // Custom fallback
 * <AccessGate
 *   accessRuleId="admin.manage"
 *   useAccess={accessApi.useAccess}
 *   fallback={<p>Admin access required</p>}
 * >
 *   <AdminPanel />
 * </AccessGate>
 */
export const AccessGate: React.FC<AccessGateProps> = ({
  accessRuleId,
  children,
  fallback,
  showDenied = false,
  deniedMessage,
  useAccess,
}) => {
  const { loading, allowed } = useAccess(accessRuleId);

  if (loading) {
    return <LoadingSpinner size="sm" />;
  }

  if (!allowed) {
    if (fallback) {
      return <>{fallback}</>;
    }
    if (showDenied) {
      return (
        <AccessDenied
          message={deniedMessage ?? `You don't have access: ${accessRuleId}`}
        />
      );
    }
    return <></>;
  }

  return <>{children}</>;
};
