/**
 * Deep validation of a proposed health-check configuration.
 *
 * `CreateHealthCheckConfigurationSchema` only validates the structural shape -
 * `config` and each collector `config` are typed as `z.record(z.unknown())`,
 * so it never checks a value against the strategy's / collector's own schema.
 * This module fills the gap with the SAME migrate-then-validate-strict logic
 * the GitOps apply path uses (`parseStrictAssumingV1`), so propose-time errors
 * match apply-time errors:
 *
 *   - unknown strategy / collector ids,
 *   - strategy `config` that violates the strategy's versioned config schema
 *     (wrong type, missing required field, AND - because validation is strict -
 *     unknown/typo'd keys),
 *   - each collector `config` that violates the collector's config schema.
 *
 * Returned issue `path`s are dot-joinable for display, e.g. `config.url` or
 * `collectors.0.config.path`. This is the shared validator behind the
 * `validateConfiguration` RPC; the GitOps reconcile path uses the same
 * migrate-then-strict helper ({@link validateVersionedConfigStrict}) so the two
 * code paths agree on what counts as valid.
 */
import { z } from "zod";
import type { Versioned } from "@checkstack/backend-api";
import type {
  HealthCheckRegistry,
  CollectorRegistry,
} from "@checkstack/backend-api";
import { extractErrorMessage } from "@checkstack/common";
import type { ValidateConfigurationInput } from "@checkstack/healthcheck-common";

export interface ConfigurationIssue {
  path: Array<string | number>;
  message: string;
}

/**
 * Migrate (assuming the stored value was written at v1) then STRICT-parse a
 * `Versioned` config. Returns the validated value on success, or the list of
 * issues on failure. Migration errors (a broken chain or a throwing `migrate`)
 * are reported as a single issue at `basePath` rather than thrown, so one bad
 * config can't abort the whole validation. Shared by the `validateConfiguration`
 * RPC and the GitOps reconcile path.
 */
export async function validateVersionedConfigStrict({
  config,
  value,
  basePath,
}: {
  config: Versioned<unknown>;
  value: unknown;
  basePath: Array<string | number>;
}): Promise<
  { ok: true; value: unknown } | { ok: false; issues: ConfigurationIssue[] }
> {
  try {
    const validated = await config.parseStrictAssumingV1(value);
    return { ok: true, value: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        issues: error.issues.map((issue) => ({
          path: [
            ...basePath,
            ...issue.path.map((segment) => toPathSegment(segment)),
          ],
          message: issue.message,
        })),
      };
    }
    return {
      ok: false,
      issues: [{ path: basePath, message: extractErrorMessage(error) }],
    };
  }
}

/**
 * Deep-validate a proposed configuration against the live registries WITHOUT
 * persisting anything. Returns an empty array when the configuration is fully
 * valid. Strategy/collector lookup is by fully-qualified id, matching the
 * GitOps reconcile path and the create path's stored `strategyId`.
 */
export async function collectConfigurationIssues({
  input,
  registry,
  collectorRegistry,
}: {
  input: ValidateConfigurationInput;
  registry: HealthCheckRegistry;
  collectorRegistry: CollectorRegistry;
}): Promise<ConfigurationIssue[]> {
  const issues: ConfigurationIssue[] = [];

  // ── Strategy resolution ──────────────────────────────────────────────────
  const allStrategies = registry.getStrategiesWithMeta();
  const matchedStrategy = allStrategies.find(
    (s) => s.qualifiedId === input.strategyId,
  );
  if (!matchedStrategy) {
    const known = allStrategies.map((s) => s.qualifiedId).join(", ");
    issues.push({
      path: ["strategyId"],
      message: `Unknown health-check strategy "${input.strategyId}". Available: ${known || "(none)"}.`,
    });
    // No strategy means the config can't be schema-validated; surface the
    // strategy issue alone so the operator fixes that first.
    return issues;
  }

  // ── Strategy config (migrate-then-validate-strict) ───────────────────────
  const strategyResult = await validateVersionedConfigStrict({
    config: matchedStrategy.strategy.config,
    value: input.config,
    basePath: ["config"],
  });
  if (!strategyResult.ok) {
    issues.push(...strategyResult.issues);
  }

  // ── Collector resolution + config (migrate-then-validate-strict) ─────────
  const allCollectors = collectorRegistry.getCollectors();
  for (const [index, entry] of (input.collectors ?? []).entries()) {
    const matchedCollector = allCollectors.find(
      (c) => c.qualifiedId === entry.collectorId,
    );
    if (!matchedCollector) {
      const known = allCollectors.map((c) => c.qualifiedId).join(", ");
      issues.push({
        path: ["collectors", index, "collectorId"],
        message: `Unknown collector "${entry.collectorId}". Available: ${known || "(none)"}.`,
      });
      continue;
    }

    const collectorResult = await validateVersionedConfigStrict({
      config: matchedCollector.collector.config,
      value: entry.config,
      basePath: ["collectors", index, "config"],
    });
    if (!collectorResult.ok) {
      issues.push(...collectorResult.issues);
    }
  }

  return issues;
}

/**
 * Zod issue paths are `PropertyKey[]` (string | number | symbol). The contract
 * issue path is `(string | number)[]`, so coerce the rare symbol segment to its
 * string form.
 */
function toPathSegment(segment: PropertyKey): string | number {
  return typeof segment === "number" || typeof segment === "string"
    ? segment
    : String(segment);
}
