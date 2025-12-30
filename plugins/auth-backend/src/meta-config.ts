import { z } from "zod";

/**
 * Meta-configuration schema for authentication strategies.
 * Stores platform-level properties separate from strategy-specific config.
 */
export const strategyMetaConfigV1 = z.object({
  enabled: z.boolean(),
});

export type StrategyMetaConfig = z.infer<typeof strategyMetaConfigV1>;

export const STRATEGY_META_CONFIG_VERSION = 1;
