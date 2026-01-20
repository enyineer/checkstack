import { InfoBanner } from "@checkstack/ui";

/**
 * Wrapper that shows access message when user lacks access.
 */
export function HealthCheckDiagramAccessGate({
  hasAccess,
  children,
}: {
  hasAccess: boolean;
  children: React.ReactNode;
}) {
  if (!hasAccess) {
    return (
      <InfoBanner variant="info">
        Additional strategy-specific visualizations are available with the
        &quot;Read Health Check Details&quot; access rule.
      </InfoBanner>
    );
  }
  return <>{children}</>;
}
