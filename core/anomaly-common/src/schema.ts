import { z } from "zod";

export const AnomalyDirectionSchema = z.enum([
  "higher-is-better",
  "lower-is-better",
  "deviation",
  "dominance",
]);
export type AnomalyDirection = z.infer<typeof AnomalyDirectionSchema>;

export const AnomalyStateSchema = z.enum([
  "suspicious",
  "anomaly",
  "recovered",
]);
export type AnomalyState = z.infer<typeof AnomalyStateSchema>;

export const AnomalyKindSchema = z.enum(["spike", "drift"]);
export type AnomalyKind = z.infer<typeof AnomalyKindSchema>;

export const FieldBaselineSchema = z.object({
  mean: z.number(),
  stdDev: z.number(),
  trendSlope: z.number(),
  sampleCount: z.number(),
  computedAt: z.string(), // ISO timestamp
  dominantValue: z.union([z.string(), z.boolean(), z.number()]).optional(),
  dominantRatio: z.number().optional(),
});
export type FieldBaseline = z.infer<typeof FieldBaselineSchema>;

export const AnomalyMetadataSchema = z
  .object({
    trendData: z.record(z.string(), z.unknown()).optional(),
    relatedAnomalies: z.array(z.string()).optional(), // UUIDs
  })
  .catchall(z.unknown());
export type AnomalyMetadata = z.infer<typeof AnomalyMetadataSchema>;

export const AnomalyFieldConfigSchema = z.object({
  enabled: z.boolean().optional(),
  sensitivity: z.number().optional(),
  confirmationWindow: z.number().int().optional(),
  direction: AnomalyDirectionSchema.optional(),
  driftEnabled: z.boolean().optional(),
  driftThreshold: z.number().optional(),
});
export type AnomalyFieldConfig = z.infer<typeof AnomalyFieldConfigSchema>;

export const AnomalySettingsSchema = z.object({
  enabled: z.boolean().default(true),
  sensitivity: z.number().default(1),
  confirmationWindow: z.number().int().default(3),
  baselineWindow: z.string().default("7d"),
  notify: z.boolean().default(true),
  driftEnabled: z.boolean().default(true),
  driftThreshold: z.number().default(2),
  fieldOverrides: z.record(z.string(), AnomalyFieldConfigSchema).optional(),
});
export type AnomalySettings = z.infer<typeof AnomalySettingsSchema>;
