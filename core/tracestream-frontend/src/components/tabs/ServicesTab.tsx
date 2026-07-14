import { useMemo, useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Card,
  CardContent,
  Badge,
  Skeleton,
  EmptyState,
  formatNumber,
  formatRelativeTime,
} from "@checkstack/ui";
import { Network } from "lucide-react";
import { TracestreamApi } from "@checkstack/tracestream-common";
import { OpBucketsSparkline } from "../OpBucketsSparkline";

export interface ServicesTabProps {
  streamId: string;
}

/**
 * Services tab: every service seen in the stream as an accordion; expanding one
 * lists its operations, each with a per-operation activity sparkline + aggregate
 * stats (calls, error rate, peak p95). Operations and buckets are only fetched
 * for the open service, so an idle service costs nothing.
 */
export function ServicesTab({ streamId }: ServicesTabProps) {
  const client = usePluginClient(TracestreamApi);
  const { data, isLoading } = client.listServices.useQuery({ streamId });
  const [openService, setOpenService] = useState<string>("");

  const services = data?.services ?? [];

  // A stable 24h window for the per-operation buckets (quantized to the minute
  // so the query key does not churn on every re-render).
  const range = useMemo(() => {
    const end = Math.ceil(Date.now() / 60_000) * 60_000;
    return {
      from: new Date(end - 24 * 60 * 60 * 1000),
      to: new Date(end),
    };
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton variant="row" />
        <Skeleton variant="row" />
        <Skeleton variant="row" />
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <EmptyState
        icon={<Network className="h-8 w-8" />}
        title="No services yet"
        description="Services appear here once spans arrive on this stream. Point an OpenTelemetry exporter at a source token to get started."
      />
    );
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <Accordion
          type="single"
          collapsible
          value={openService}
          onValueChange={setOpenService}
        >
          {services.map((service) => (
            <AccordionItem key={service.serviceName} value={service.serviceName}>
              <AccordionTrigger className="gap-3 text-left">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {service.serviceName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    last seen {formatRelativeTime(service.lastSeenAt)}
                  </span>
                </span>
                <Badge variant="secondary">
                  {formatNumber(service.operationCount)} ops
                </Badge>
              </AccordionTrigger>
              <AccordionContent>
                {openService === service.serviceName && (
                  <ServiceOperations
                    streamId={streamId}
                    serviceName={service.serviceName}
                    from={range.from}
                    to={range.to}
                  />
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function ServiceOperations({
  streamId,
  serviceName,
  from,
  to,
}: {
  streamId: string;
  serviceName: string;
  from: Date;
  to: Date;
}) {
  const client = usePluginClient(TracestreamApi);
  const { data, isLoading } = client.listOperations.useQuery({
    streamId,
    serviceName,
  });

  if (isLoading) {
    return <Skeleton variant="text" className="h-8 w-full" />;
  }

  const operations = data?.operations ?? [];
  if (operations.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No operations recorded for this service.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {operations.map((op) => (
        <li key={op.spanName} className="space-y-2 py-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate font-mono text-sm text-foreground">
              {op.spanName}
            </span>
            <Badge variant="outline">{op.kind}</Badge>
          </div>
          <OpBucketsSparkline
            streamId={streamId}
            serviceName={serviceName}
            spanName={op.spanName}
            from={from}
            to={to}
          />
        </li>
      ))}
    </ul>
  );
}
