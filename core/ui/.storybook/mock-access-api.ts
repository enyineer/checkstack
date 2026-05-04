import type { AccessApi } from "@checkstack/frontend-api";

export const mockAccessApi: AccessApi = {
  useAccess: () => ({ loading: false, allowed: true }),
};
