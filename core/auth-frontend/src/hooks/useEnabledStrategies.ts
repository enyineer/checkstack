import { useState, useEffect } from "react";
import { useApi, rpcApiRef } from "@checkmate/frontend-api";
import type { AuthClient } from "@checkmate/auth-common";
import type { EnabledAuthStrategy } from "../api";

export interface UseEnabledStrategiesResult {
  strategies: EnabledAuthStrategy[];
  loading: boolean;
  error?: Error;
}

export const useEnabledStrategies = (): UseEnabledStrategiesResult => {
  const rpcApi = useApi(rpcApiRef);
  const authClient = rpcApi.forPlugin<AuthClient>("auth");

  const [strategies, setStrategies] = useState<EnabledAuthStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();

  useEffect(() => {
    let mounted = true;

    const fetchStrategies = async () => {
      try {
        setLoading(true);
        const result = await authClient.getEnabledStrategies();
        if (mounted) {
          setStrategies(result);
          setError(undefined);
        }
      } catch (error_) {
        if (mounted) {
          setError(
            error_ instanceof Error
              ? error_
              : new Error("Failed to fetch strategies")
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchStrategies();

    return () => {
      mounted = false;
    };
  }, [authClient]);

  return { strategies, loading, error };
};
