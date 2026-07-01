import type { ReactNode } from "react";
import { useApi, accessApiRef } from "@checkstack/frontend-api";
import type { AccessRule, ResourceType } from "@checkstack/common";

/**
 * Shared render policy for the capability gates: fail-closed while loading, then
 * show `children` when allowed and `fallback` otherwise. Pure so it is unit-
 * tested without a React renderer; the gate components below are thin wrappers.
 */
export function resolveGate({
  loading,
  allowed,
  children,
  fallback,
  loadingFallback,
}: {
  loading: boolean;
  allowed: boolean;
  children: ReactNode;
  fallback: ReactNode;
  loadingFallback: ReactNode;
}): ReactNode {
  if (loading) return loadingFallback;
  return allowed ? children : fallback;
}

interface CapabilityGateProps {
  /** The write rule the surface is gated on (e.g. `incidentAccess.incident.manage`). */
  accessRule: AccessRule;
  /** The qualified resource type (e.g. `incidentResourceTypes.incident`). */
  objectType: ResourceType;
  /** Optional parent type - managing the parent unlocks the surface. */
  parentType?: ResourceType;
  /** Rendered when the capability is granted. */
  children: ReactNode;
  /** Rendered when it is NOT granted (default: nothing). */
  fallback?: ReactNode;
  /** Rendered while the check is loading (default: nothing - fail-closed). */
  loadingFallback?: ReactNode;
}

/**
 * Renders its children only when the caller can CREATE this resource type -
 * globally, via a team create-capability grant, or by managing the parent. Use
 * it to gate a "Create X" button/menu item so team-scoped users see it exactly
 * when the backend would accept their create. For pages that also need the
 * boolean elsewhere, call `accessApi.useCanCreate` directly.
 */
export function CreateGate({
  accessRule,
  objectType,
  parentType,
  children,
  fallback = null,
  loadingFallback = null,
}: CapabilityGateProps): ReactNode {
  const accessApi = useApi(accessApiRef);
  const { allowed, loading } = accessApi.useCanCreate({
    accessRule,
    objectType,
    parentType,
  });
  return resolveGate({ loading, allowed, children, fallback, loadingFallback });
}

/**
 * Renders its children only when the caller can reach a MANAGEMENT SURFACE for
 * this resource type (create capability OR managing any existing instance / its
 * parent). Use it to gate an in-page management section; a page that returns an
 * "access denied" state should pass it as `fallback`.
 */
export function ManageTypeGate({
  accessRule,
  objectType,
  parentType,
  children,
  fallback = null,
  loadingFallback = null,
}: CapabilityGateProps): ReactNode {
  const accessApi = useApi(accessApiRef);
  const { allowed, loading } = accessApi.useCanAccessType({
    accessRule,
    objectType,
    parentType,
  });
  return resolveGate({ loading, allowed, children, fallback, loadingFallback });
}
