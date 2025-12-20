import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";

export const usePermissions = () => {
  const { data: session } = authClient.useSession();
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    if (!session?.user) {
      setPermissions([]);
      return;
    }

    const fetchPermissions = async () => {
      try {
        const res = await fetch("/api/auth-backend/permissions");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.permissions)) {
            setPermissions(data.permissions as string[]);
          }
        }
      } catch (error) {
        console.error("Failed to fetch permissions", error);
      }
    };
    fetchPermissions();
  }, [session?.user?.id]);

  return permissions;
};
