import { useEffect, useState } from "react";
import { useAuthClient } from "../lib/auth-client";
import { rpcApiRef, useApi } from "@checkstack/frontend-api";
import { AuthApi } from "@checkstack/auth-common";

export const useAccessRules = () => {
  const authClient = useAuthClient();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [accessRules, setAccessRules] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const rpcApi = useApi(rpcApiRef);

  useEffect(() => {
    // Don't set loading=false while session is still pending
    // This prevents "Access Denied" flash during initial page load
    if (sessionPending) {
      return;
    }

    if (!session?.user) {
      setAccessRules([]);
      setLoading(false);
      return;
    }

    const fetchAccessRules = async () => {
      try {
        const authRpc = rpcApi.forPlugin(AuthApi);
        const data = await authRpc.accessRules();
        if (Array.isArray(data.accessRules)) {
          setAccessRules(data.accessRules);
        }
      } catch (error) {
        console.error("Failed to fetch access rules", error);
      } finally {
        setLoading(false);
      }
    };
    fetchAccessRules();
  }, [session?.user?.id, sessionPending, rpcApi]);

  return { accessRules, loading };
};
