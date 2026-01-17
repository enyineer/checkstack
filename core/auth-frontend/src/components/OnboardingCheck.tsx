import { AuthApi } from "@checkstack/auth-common";
import { usePluginClient } from "@checkstack/frontend-api";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Onboarding guard that redirects to onboarding page if no users exist.
 * Skips check if already on onboarding page.
 */
export function OnboardingCheck() {
  const navigate = useNavigate();
  const location = useLocation();
  const authApi = usePluginClient(AuthApi);

  const { data, isLoading } = authApi.getOnboardingStatus.useQuery();

  useEffect(() => {
    if (isLoading) {
      return;
    }

    // Skip check if already on onboarding page
    if (location.pathname === "/auth/onboarding") {
      return;
    }

    if (data?.needsOnboarding) {
      navigate("/auth/onboarding", { replace: true });
    }
  }, [isLoading, data, location.pathname, navigate]);

  return <></>;
}
