import React from "react";
import { usePluginClient, type SlotContext } from "@checkstack/frontend-api";
import { SystemDetailsTopSlot } from "@checkstack/catalog-common";
import {
  DependencyApi,
  type DerivedState,
  type AffectedUpstream,
} from "@checkstack/dependency-common";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
} from "@checkstack/ui";
import { ArrowUpRight, AlertTriangle, Info } from "lucide-react";

type Props = SlotContext<typeof SystemDetailsTopSlot>;

function getAlertStyle(state: DerivedState): {
  border: string;
  bg: string;
  headerBg: string;
  icon: React.ReactNode;
  label: string;
} {
  switch (state) {
    case "down": {
      return {
        border: "border-destructive/30",
        bg: "bg-destructive/5",
        headerBg: "bg-destructive/10",
        icon: <AlertTriangle className="h-5 w-5 text-destructive" />,
        label: "Critical Upstream Failure",
      };
    }
    case "degraded": {
      return {
        border: "border-warning/30",
        bg: "bg-warning/5",
        headerBg: "bg-warning/10",
        icon: <AlertTriangle className="h-5 w-5 text-warning" />,
        label: "Upstream Degradation",
      };
    }
    default: {
      return {
        border: "border-info/30",
        bg: "bg-info/5",
        headerBg: "bg-info/10",
        icon: <Info className="h-5 w-5 text-info" />,
        label: "Upstream Dependency Notice",
      };
    }
  }
}

function getImpactBadge(impactType: string): React.ReactNode {
  switch (impactType) {
    case "critical": {
      return <Badge variant="destructive">Critical</Badge>;
    }
    case "degraded": {
      return <Badge variant="warning">Degraded</Badge>;
    }
    default: {
      return <Badge variant="secondary">Info</Badge>;
    }
  }
}

/**
 * Alert banner component injected into the SystemDetailsTopSlot.
 * Shows warnings when upstream dependencies are affected.
 */
export const DependencyAlert: React.FC<Props> = ({ system }) => {
  const depClient = usePluginClient(DependencyApi);

  const { data } = depClient.getWarningsForSystem.useQuery(
    { systemId: system?.id ?? "" },
    { enabled: !!system?.id },
  );

  if (!data || data.affectedUpstreams.length === 0) return;

  const style = getAlertStyle(data.derivedState);

  return (
    <Card className={`${style.border} ${style.bg}`}>
      <CardHeader
        className={`border-b border-border py-3 ${style.headerBg}`}
      >
        <div className="flex items-center gap-2">
          {style.icon}
          <CardTitle className="text-lg font-semibold">{style.label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-2">
        <p className="text-sm text-muted-foreground mb-3">
          This system is affected by upstream dependency issues:
        </p>
        {data.affectedUpstreams.map((upstream: AffectedUpstream) => (
          <div
            key={upstream.systemId}
            className="flex items-center justify-between p-2 rounded border border-border bg-background"
          >
            <div className="flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {upstream.systemName}
              </span>
              {upstream.dependencyLabel && (
                <span className="text-xs text-muted-foreground">
                  ({upstream.dependencyLabel})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {upstream.ownStatus}
              </Badge>
              {getImpactBadge(upstream.impactType)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
