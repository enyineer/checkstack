import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import { rpcApiRef, useApi } from "@checkmate/frontend-api";
import { AuthClient } from "../api";

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
        const authRpc = rpcApi.forPlugin<AuthClient>("auth");
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
