import { useEffect, useState } from "react";
import { useAuthClient } from "../lib/auth-client";
import { rpcApiRef, useApi } from "@checkmate-monitor/frontend-api";
import { AuthApi } from "@checkmate-monitor/auth-common";

export const usePermissions = () => {
  const authClient = useAuthClient();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const rpcApi = useApi(rpcApiRef);

  useEffect(() => {
    // Don't set loading=false while session is still pending
    // This prevents "Access Denied" flash during initial page load
    if (sessionPending) {
      return;
    }

    if (!session?.user) {
      setPermissions([]);
      setLoading(false);
      return;
    }

    const fetchPermissions = async () => {
      try {
        const authRpc = rpcApi.forPlugin(AuthApi);
        const data = await authRpc.permissions();
        if (Array.isArray(data.permissions)) {
          setPermissions(data.permissions);
        }
      } catch (error) {
        console.error("Failed to fetch permissions", error);
      } finally {
        setLoading(false);
      }
    };
    fetchPermissions();
  }, [session?.user?.id, sessionPending, rpcApi]);

  return { permissions, loading };
};
