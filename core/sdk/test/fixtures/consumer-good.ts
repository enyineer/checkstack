// Fixture: an external consumer importing the self-contained helper subpaths.
// Under `nodenext`/`node16` module resolution, each subpath MUST resolve
// through the package's `exports` map to its OWN per-subpath `.d.ts`
// (generated/healthcheck.d.ts, generated/integration.d.ts) — not a shared
// ambient file. This file MUST typecheck cleanly.
import {
  defineHealthCheck,
  type HealthCheckScriptContext,
  type HealthCheckScriptResult,
} from "@checkstack/sdk/healthcheck";
import {
  defineIntegration,
  type IntegrationScriptContext,
  type IntegrationScriptResult,
} from "@checkstack/sdk/integration";

const hcResult: HealthCheckScriptResult = { success: true, value: 1 };
const intgResult: IntegrationScriptResult = { id: "x" };

export const hc = defineHealthCheck((ctx: HealthCheckScriptContext) => ({
  success: ctx.check.intervalSeconds > 0,
  value: hcResult.value,
}));

export const intg = defineIntegration((ctx: IntegrationScriptContext) => ({
  id: ctx.event.deliveryId,
  externalId: intgResult.id,
}));
