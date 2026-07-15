import { useMemo, useState } from "react";
import { Tabs, Button, useToast } from "@checkstack/ui";
import { Copy } from "lucide-react";
import type {
  PushEndpointDescriptor,
  TelemetrySignal,
} from "@checkstack/telemetry-common";
import {
  buildPushSnippets,
  type PushSnippetId,
} from "../lib/push-snippets.logic";

export interface PushSnippetsPanelProps {
  /** The type's inbound endpoints (from the descriptor or a PushInfo reveal). */
  endpoints: PushEndpointDescriptor[];
  /** Signals the instance emits; drives the OTLP endpoint keys. */
  signals: TelemetrySignal[];
  /**
   * A freshly-minted token to bake into the snippets. Omitted when retrieving
   * setup for an existing source (only the token is shown once), so the
   * snippets carry a visible placeholder instead.
   */
  token?: string;
}

/**
 * Ready-to-paste setup snippets for a PUSH source, templated with this
 * instance's real endpoints (origin-prefixed from `window.location.origin`).
 * Renders an "OTel Collector" tab for the type's OTLP endpoint and a "curl
 * (native)" tab for its native endpoint. Shown both on the create/rotate reveal
 * (with the live token) and when viewing an existing push source (placeholder
 * token, since the real one is never retrievable again). Self-contained opaque
 * surface so it reads correctly on any page backdrop.
 */
export function PushSnippetsPanel({
  endpoints,
  signals,
  token,
}: PushSnippetsPanelProps) {
  const toast = useToast();

  const origin =
    globalThis.window === undefined
      ? "https://checkstack"
      : globalThis.window.location.origin;

  const snippets = useMemo(
    () => buildPushSnippets({ origin, endpoints, signals, token }),
    [origin, endpoints, signals, token],
  );

  const [activeTab, setActiveTab] = useState<PushSnippetId>(
    snippets[0]?.id ?? "otel-collector",
  );
  const active = snippets.find((s) => s.id === activeTab) ?? snippets[0];

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  if (!active) return null;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-inset p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Ship telemetry</p>
        <p className="text-xs text-muted-foreground">
          Point a shipper at{" "}
          {endpoints.map((endpoint, i) => (
            <span key={endpoint.path}>
              {i > 0 ? " or " : ""}
              <code className="font-mono text-xs">
                {origin}
                {endpoint.path}
              </code>{" "}
              ({endpoint.label})
            </span>
          ))}
          , authenticated with the source token below.
        </p>
      </div>

      {snippets.length > 1 && (
        <Tabs
          items={snippets.map((s) => ({ id: s.id, label: s.label }))}
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as PushSnippetId)}
        />
      )}

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
        <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-card p-3 pr-20 font-mono text-xs leading-relaxed text-foreground">
          {active.code}
        </pre>
      </div>
    </div>
  );
}
