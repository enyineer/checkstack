import { useMemo, useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Tabs,
  Button,
  useToast,
} from "@checkstack/ui";
import { Copy } from "lucide-react";
import {
  buildMetricSnippets,
  METRICSTREAM_ENDPOINTS,
  type MetricSnippetId,
} from "../lib/ship-metrics";

export interface PushEndpointsCardProps {
  /** A live source token to interpolate, or omit for a visible placeholder. */
  token?: string;
}

/**
 * Copy-paste setup snippets for the push sources (OTLP/HTTP and native JSON),
 * templated with this instance's real endpoints (from `window.location.origin`).
 * The token defaults to a placeholder unless a freshly-minted secret is passed
 * in. Prometheus is a pull source configured under "Scrape targets", so it has
 * no push snippet here.
 */
export function PushEndpointsCard({ token }: PushEndpointsCardProps) {
  const toast = useToast();
  const baseUrl =
    globalThis.window === undefined
      ? "https://checkstack"
      : globalThis.window.location.origin;
  const snippets = useMemo(
    () => buildMetricSnippets({ baseUrl, token }),
    [baseUrl, token],
  );
  const [activeTab, setActiveTab] = useState<MetricSnippetId>(snippets[0].id);
  const active = snippets.find((s) => s.id === activeTab) ?? snippets[0];

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Push metrics</CardTitle>
        <CardDescription>
          Point a shipper at{" "}
          <code className="font-mono text-xs">
            {baseUrl}
            {METRICSTREAM_ENDPOINTS.otlpMetrics}
          </code>{" "}
          (OTLP) or{" "}
          <code className="font-mono text-xs">
            {baseUrl}
            {METRICSTREAM_ENDPOINTS.native}
          </code>{" "}
          (native JSON), authenticated with a{" "}
          <code className="font-mono text-xs">ckms_</code> source token minted
          below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs
          items={snippets.map((s) => ({ id: s.id, label: s.label }))}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as MetricSnippetId)}
        />
        <p className="text-sm text-muted-foreground">{active.description}</p>
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="absolute right-2 top-2 z-10"
            onClick={() => void copy(active.code)}
          >
            <Copy className="size-3.5" />
            Copy
          </Button>
          <pre className="max-h-96 overflow-auto rounded-lg border bg-surface-inset p-3 pr-20 font-mono text-xs leading-relaxed text-foreground">
            {active.code}
          </pre>
        </div>
        {!token && (
          <p className="text-xs text-muted-foreground">
            Replace the token placeholder with a source token minted below.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
