import z from "zod";
import { configNumber } from "./zod-config";

/**
 * Base configuration schema that all strategy configs should extend.
 * Provides the required `timeout` field with a sensible default.
 *
 * @example
 * ```typescript
 * const myConfigSchema = baseStrategyConfigSchema.extend({
 *   host: z.string().describe("Server hostname"),
 *   port: z.number().default(22),
 * });
 * ```
 */
export const baseStrategyConfigSchema = z.object({
  timeout: configNumber({})
    .min(100)
    .default(30_000)
    .describe("Execution timeout in milliseconds"),
});

/**
 * Base config type that all strategy configs must satisfy.
 */
export type BaseStrategyConfig = z.infer<typeof baseStrategyConfigSchema>;

/**
 * Shared timeout field for outbound HTTP requests (webhooks, integration
 * deliveries, inline scripts). Standardises bounds and default across plugins
 * so operators see a consistent UX in the config UI.
 *
 * Bounds: `1_000ms` to `60_000ms`, default `10_000ms`.
 *
 * @example
 * ```typescript
 * const provider = z.object({
 *   url: configString({}).url(),
 *   timeout: requestTimeoutMs().describe("Request timeout in milliseconds"),
 * });
 * ```
 */
export function requestTimeoutMs() {
  return configNumber({}).min(1000).max(60_000).default(10_000);
}
