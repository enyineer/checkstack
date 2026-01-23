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
