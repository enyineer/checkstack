import React from "react";
import { Zap, ZapOff } from "lucide-react";
import { useApi } from "@checkstack/frontend-api";
import { authApiRef } from "@checkstack/auth-frontend/api";
import { Button, usePerformance } from "@checkstack/ui";

/**
 * Navbar performance toggle button for non-logged-in users.
 *
 * Shows a Zap icon button that toggles between high and low performance modes.
 * Only renders when user is NOT logged in (logged-in users use the toggle in UserMenu).
 */
export const NavbarPerformanceToggle = () => {
  const { manualLowPower, toggleManualLowPower } = usePerformance();
  const authApi = useApi(authApiRef);
  const { data: session, isPending } = authApi.useSession();

  // Don't render while loading session
  if (isPending) {
    return <React.Fragment />;
  }

  // Don't render for logged-in users (they use UserMenu toggle)
  if (session?.user) {
    return <React.Fragment />;
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleManualLowPower}
      aria-label={manualLowPower ? "Switch to high performance" : "Switch to low power mode"}
      className="rounded-full"
    >
      {manualLowPower ? <ZapOff className="h-5 w-5 text-muted-foreground" /> : <Zap className="h-5 w-5 text-primary" />}
    </Button>
  );
};
