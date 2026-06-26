import type { CreateHealthCheckConfiguration } from "@checkstack/healthcheck-common";

/** Sensible default probe interval for a first HTTP check. */
export const DEFAULT_INTERVAL_SECONDS = 60;

/** The built-in HTTP strategy + its Request collector (always installed). */
export const HTTP_STRATEGY_ID = "healthcheck-http.http";
export const HTTP_REQUEST_COLLECTOR_ID = "healthcheck-http.request";

/**
 * Resolve the health-check name: the operator's input if present, otherwise a
 * sensible default derived from the system name. Returns an empty string when
 * neither is available (the wizard blocks submission in that case).
 */
export function resolveCheckName({
  checkName,
  systemName,
}: {
  checkName: string;
  systemName: string;
}): string {
  const trimmed = checkName.trim();
  if (trimmed) return trimmed;
  const system = systemName.trim();
  return system ? `${system} reachability` : "";
}

/**
 * Build the minimal HTTP `CreateHealthCheckConfiguration` from a URL: the
 * built-in `http` strategy with its `request` collector pointed at the URL and a
 * `statusCode equals 200` assertion. The collector instance `id` is injected so
 * this stays a pure, testable function (the component passes a fresh UUID).
 */
export function buildHttpCheckConfiguration({
  url,
  checkName,
  systemName,
  intervalSeconds,
  collectorId,
}: {
  url: string;
  checkName: string;
  systemName: string;
  intervalSeconds: number;
  collectorId: string;
}): CreateHealthCheckConfiguration {
  return {
    name: resolveCheckName({ checkName, systemName }),
    strategyId: HTTP_STRATEGY_ID,
    // The HTTP strategy needs only request defaults; the URL lives on the
    // collector. Runtime fills in defaults on read.
    config: {},
    intervalSeconds,
    collectors: [
      {
        id: collectorId,
        collectorId: HTTP_REQUEST_COLLECTOR_ID,
        config: { url: url.trim() },
        assertions: [{ field: "statusCode", operator: "equals", value: 200 }],
      },
    ],
  };
}
