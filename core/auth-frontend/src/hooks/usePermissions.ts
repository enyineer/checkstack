import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import { rpcApiRef, useApi } from "@checkmate-monitor/frontend-api";
import { AuthApi } from "@checkmate-monitor/auth-common";

export const usePermissions = () => {
  const { data: session } = authClient.useSession();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const rpcApi = useApi(rpcApiRef);

  useEffect(() => {
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
  }, [session?.user?.id, rpcApi]);

  return { permissions, loading };
};
