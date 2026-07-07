import type { AccessApi } from "@checkstack/frontend-api";

export const mockAccessApi: AccessApi = {
  useAccess: () => ({ loading: false, allowed: true }),
  useProcedureAccess: () => ({ loading: false, allowed: true }),
  useSurfaceAccess: () => ({ loading: false, allowed: true }),
  useCanAccessType: () => ({ loading: false, allowed: true }),
  useRouteAccess: () => ({ loading: false, allowed: true }),
  useResourceAccess: () => ({
    loading: false,
    hasGlobal: true,
    canAccess: () => true,
  }),
  useIsAuthenticated: () => ({ loading: false, isAuthenticated: true }),
};
