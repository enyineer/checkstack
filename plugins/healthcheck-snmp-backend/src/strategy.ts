import {
  HealthCheckStrategy,
  Versioned,
  type ConnectedClient,
  type HealthCheckRunForAggregation,
} from "@checkstack/backend-api";
import { StrategyCategory } from "@checkstack/healthcheck-common";
import { extractErrorMessage } from "@checkstack/common";
import {
  snmpConfigSchema,
  snmpResultSchema,
  snmpAggregatedFields,
  renderedHostSchema,
  createSnmpAggregatedResult,
  mergeSnmpAggregated,
  type SnmpConfig,
  type SnmpResult,
  type SnmpAggregatedResult,
} from "./schemas";
import {
  defaultSnmpSessionFactory,
  type SnmpSessionFactory,
} from "./snmp-session";
import { normalizeVarbind } from "./snmp-varbind";
import type {
  SnmpTransportClient,
  SnmpRequest,
  SnmpResult as SnmpTransportResult,
} from "./transport-client";

// ============================================================================
// STRATEGY
// ============================================================================

export class SnmpHealthCheckStrategy implements HealthCheckStrategy<
  SnmpConfig,
  SnmpTransportClient,
  SnmpResult,
  typeof snmpAggregatedFields
> {
  id = "snmp";
  displayName = "SNMP Health Check";
  description = "Query an SNMP agent OID and assert on the returned value";
  category = StrategyCategory.NETWORKING;

  private sessionFactory: SnmpSessionFactory;

  constructor(sessionFactory: SnmpSessionFactory = defaultSnmpSessionFactory) {
    this.sessionFactory = sessionFactory;
  }

  config: Versioned<SnmpConfig> = new Versioned({
    version: 1,
    schema: snmpConfigSchema,
  });

  result: Versioned<SnmpResult> = new Versioned({
    version: 1,
    schema: snmpResultSchema,
  });

  aggregatedResult = createSnmpAggregatedResult();

  mergeResult(
    existing: SnmpAggregatedResult | undefined,
    run: HealthCheckRunForAggregation<SnmpResult>,
  ): SnmpAggregatedResult {
    return mergeSnmpAggregated(existing, run);
  }

  async createClient(
    config: unknown,
  ): Promise<ConnectedClient<SnmpTransportClient>> {
    const validatedConfig = this.config.validate(config);

    // Post-render guard: `host` is a templatable string, so `.min(1)` cannot run
    // at store time. The executor has already rendered `{{ environment.* }}`
    // into `config.host`; reject a render that collapsed to empty here so the
    // run fails clearly instead of building a session for an empty target.
    const host = renderedHostSchema.safeParse(validatedConfig.host);
    if (!host.success) {
      throw new Error(
        `Rendered host is empty: ${JSON.stringify(validatedConfig.host)}. ` +
          `Check the {{ environment.* }} templating for this environment.`,
      );
    }

    const session = this.sessionFactory({
      ...validatedConfig,
      host: host.data,
    });

    const client: SnmpTransportClient = {
      exec: async (request: SnmpRequest): Promise<SnmpTransportResult> => {
        const start = performance.now();
        const elapsed = (): number =>
          Math.max(0, Math.round(performance.now() - start));

        try {
          const raw = await session.get(request.oid);
          // An exception varbind (noSuchObject / noSuchInstance / endOfMibView)
          // and any returned value are COMPLETED responses: expose them as
          // assertable metrics, never as a transport `error`.
          const normalized = normalizeVarbind(raw);
          return {
            value: normalized.numericValue,
            valueString: normalized.stringValue,
            valueType: normalized.typeName,
            responseTimeMs: elapsed(),
          };
        } catch (error_) {
          // Only a genuine transport failure lands here (socket unreachable,
          // timeout / abort, v3 auth handshake failure).
          return {
            valueType: "error",
            responseTimeMs: elapsed(),
            error: extractErrorMessage(error_),
          };
        }
      },
    };

    return {
      client,
      close: () => session.close(),
    };
  }
}
