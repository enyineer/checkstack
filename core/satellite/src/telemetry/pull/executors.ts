/**
 * STATICALLY-LINKED satellite pull executors. Every telemetry-pull source
 * type that supports satellite execution registers its pure executor here at
 * agent startup - the platform pushes each instance's (non-secret) config and
 * the scheduler resolves the executor by qualified source-type id. Adding a
 * new satellite-capable pull source type means adding exactly one
 * registration line here. The executors live in THIS package (they need the
 * backend-api SSRF guard, which a `*-common` leaf must not import); their
 * pure parsing/mapping drivers live in browser-safe `*-common` leaves so
 * core and agent share the logic.
 */

import { telemetryPullExecutorRegistry } from "./executor-registry";
import { prometheusPullExecutor } from "./prometheus-executor";
import { k8sEventsPullExecutor } from "./k8s-events-executor";

/** Register every built-in executor. Idempotence is the registry's concern
 * (duplicates throw), so this must run exactly once at startup. */
export function registerBuiltinPullExecutors(): void {
  telemetryPullExecutorRegistry.register(prometheusPullExecutor);
  telemetryPullExecutorRegistry.register(k8sEventsPullExecutor);
}
