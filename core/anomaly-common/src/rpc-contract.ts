import { createClientDefinition, proc } from "@checkstack/common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";
import { AnomalyStateSchema } from "./schema";
import { anomalyAccess } from "./access";

export const AnomalyDtoSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  configurationId: z.string(),
  fieldPath: z.string(),
  state: AnomalyStateSchema,
  direction: z.enum(["above", "below", "changed"]),
  baselineValue: z.number().nullable(),
  baselineStdDev: z.number().nullable(),
  observedValue: z.string(),
  deviation: z.number(),
  suspiciousRunCount: z.number(),
  confirmationThreshold: z.number(),
  startedAt: z.string(),
  confirmedAt: z.string().nullable(),
  recoveredAt: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export type AnomalyDto = z.infer<typeof AnomalyDtoSchema>;

export const AnomalyBaselineDtoSchema = z.object({
  id: z.string(),
  systemId: z.string(),
  configurationId: z.string(),
  fieldPath: z.string(),
  mean: z.number(),
  stdDev: z.number(),
  trendSlope: z.number(),
  sampleCount: z.number(),
  computedAt: z.string(),
  dominantValue: z.string().nullable(),
  dominantRatio: z.number().nullable(),
});

export type AnomalyBaselineDto = z.infer<typeof AnomalyBaselineDtoSchema>;

export const anomalyContract = {
  getAnomalies: proc({
    operationType: "query",
    userType: "public",
    access: [anomalyAccess.feed.read],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({
      systemId: z.string().optional(),
      configurationId: z.string().optional(),
      state: AnomalyStateSchema.optional(),
      limit: z.number().optional().default(50),
    }))
    .output(z.array(AnomalyDtoSchema)),

  getAnomalyBaselines: proc({
    operationType: "query",
    userType: "public",
    access: [anomalyAccess.feed.read],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({
      systemId: z.string(),
      configurationId: z.string(),
    }))
    .output(z.array(AnomalyBaselineDtoSchema)),

  getAnomalyConfig: proc({
    operationType: "query",
    userType: "authenticated",
    access: [anomalyAccess.feed.manage],
  })
    .input(z.object({
      configurationId: z.string(),
    }))
    .output(z.any()), // Output is a VersionedRecord<AnomalySettings>

  updateAnomalyConfig: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [anomalyAccess.feed.manage],
  })
    .input(z.object({
      configurationId: z.string(),
      config: z.any(), // Input is a AnomalySettings
    }))
    .output(z.any()), // Returns updated VersionedRecord

  getAnomalyAssignmentConfig: proc({
    operationType: "query",
    userType: "authenticated",
    access: [anomalyAccess.feed.manage],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({
      systemId: z.string(),
      configurationId: z.string(),
    }))
    .output(z.any().nullable()), // Returns VersionedRecord<Partial<AnomalySettings>> or null

  updateAnomalyAssignmentConfig: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [anomalyAccess.feed.manage],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({
      systemId: z.string(),
      configurationId: z.string(),
      config: z.any(), // Input is Partial<AnomalySettings>
    }))
    .output(z.any()),
};

export type AnomalyContract = typeof anomalyContract;

export const AnomalyApi = createClientDefinition(
  anomalyContract,
  pluginMetadata
);
