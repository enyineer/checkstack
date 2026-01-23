/**
 * ExpandedResultView - Displays basic health check result metadata.
 *
 * Shows status, latency, and connection time. Collector results and
 * detailed visualizations are handled by SingleRunChartGrid.
 */

interface ExpandedResultViewProps {
  result: Record<string, unknown>;
}

/**
 * Displays basic run metadata (status, latency, connection time).
 */
export function ExpandedResultView({ result }: ExpandedResultViewProps) {
  const metadata = result.metadata as Record<string, unknown> | undefined;
  const connectionTimeMs = metadata?.connectionTimeMs as number | undefined;

  return (
    <div className="flex flex-wrap gap-4 text-sm">
      <div>
        <span className="text-muted-foreground">Status: </span>
        <span className="font-medium">{String(result.status)}</span>
      </div>
      <div>
        <span className="text-muted-foreground">Latency: </span>
        <span className="font-medium">{String(result.latencyMs)}ms</span>
      </div>
      {connectionTimeMs !== undefined && (
        <div>
          <span className="text-muted-foreground">Connection: </span>
          <span className="font-medium">{connectionTimeMs}ms</span>
        </div>
      )}
    </div>
  );
}
