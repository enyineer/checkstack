import { useState } from "react";
import { usePluginClient } from "@checkstack/frontend-api";
import {
  Card,
  CardContent,
  Input,
  Badge,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  EmptyState,
  Skeleton,
  formatNumber,
  formatRelativeTime,
} from "@checkstack/ui";
import { Gauge } from "lucide-react";
import { MetricstreamApi } from "@checkstack/metricstream-common";
import { useDebouncedValue } from "@checkstack/ui";
import { MetricDetail } from "./MetricDetail";

export interface MetricsBrowserProps {
  streamId: string;
}

/**
 * Searchable metric browser. Each row shows a metric's type, unit, series count
 * (cardinality context) and last-seen time; expanding a row lazily loads its
 * label keys and a sample of concrete series. Search is server-side (the
 * `listMetricNames` `query` filter) so it scales past the page limit.
 */
export function MetricsBrowser({ streamId }: MetricsBrowserProps) {
  const client = usePluginClient(MetricstreamApi);
  const [search, setSearch] = useState("");
  const [openMetric, setOpenMetric] = useState<string>("");
  const debouncedSearch = useDebouncedValue(search, 250);

  const { data, isLoading } = client.listMetricNames.useQuery({
    streamId,
    query: debouncedSearch.trim() || undefined,
    limit: 500,
  });

  const metrics = data?.names ?? [];

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search metrics..."
      />

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton variant="row" />
              <Skeleton variant="row" />
              <Skeleton variant="row" />
            </div>
          ) : metrics.length === 0 ? (
            <EmptyState
              icon={<Gauge className="h-6 w-6" />}
              title={search ? "No matching metrics" : "No metrics yet"}
              description={
                search
                  ? "No metric names match your search."
                  : "Metrics appear here once a source starts sending to this stream."
              }
            />
          ) : (
            <Accordion
              type="single"
              collapsible
              value={openMetric}
              onValueChange={setOpenMetric}
            >
              {metrics.map((metric) => (
                <AccordionItem key={metric.name} value={metric.name}>
                  <AccordionTrigger className="gap-3 text-left">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-mono text-sm font-medium text-foreground">
                        {metric.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatNumber(metric.seriesCount)} series · last seen{" "}
                        {formatRelativeTime(metric.lastSeenAt)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Badge variant="secondary">{metric.type}</Badge>
                      {metric.unit && (
                        <Badge variant="outline">{metric.unit}</Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {openMetric === metric.name && (
                      <MetricDetail
                        streamId={streamId}
                        metricName={metric.name}
                      />
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
