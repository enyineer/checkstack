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
  buildTraceSnippets,
  TRACESTREAM_ENDPOINTS,
  type ShipSnippetId,
} from "../lib/ship-traces";

export interface ShipTracesInstructionsProps {
  /** A live source token to interpolate, or omit for a visible placeholder. */
  token?: string;
}

/**
 * Copy-paste setup snippets for every supported way to send spans (OTel SDK env
 * vars, an OTel Collector otlphttp exporter, a native OTLP-JSON curl), templated
 * with this instance's real endpoint (derived from `window.location.origin`).
 * The token defaults to a placeholder unless a freshly-minted secret is passed.
 */
export function ShipTracesInstructions({ token }: ShipTracesInstructionsProps) {
  const toast = useToast();
  const baseUrl =
    globalThis.window === undefined
      ? "https://checkstack"
      : globalThis.window.location.origin;
  const snippets = useMemo(
    () => buildTraceSnippets({ baseUrl, token }),
    [baseUrl, token],
  );
  const [activeTab, setActiveTab] = useState<ShipSnippetId>(snippets[0]!.id);
  const active = snippets.find((s) => s.id === activeTab) ?? snippets[0]!;

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
        <CardTitle>Ship traces</CardTitle>
        <CardDescription>
          Point an OpenTelemetry exporter at{" "}
          <code className="font-mono text-xs">
            {baseUrl}
            {TRACESTREAM_ENDPOINTS.otlpTraces}
          </code>{" "}
          (OTLP/HTTP), authenticated with a source token.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Tabs
          items={snippets.map((s) => ({ id: s.id, label: s.label }))}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as ShipSnippetId)}
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
            Replace the token placeholder with a source token minted above.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
