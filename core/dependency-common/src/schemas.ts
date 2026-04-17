import { z } from "zod";

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Impact type determines how an upstream system's status affects the downstream.
 * - informational: Show a link/badge, no status impact
 * - degraded: Downstream shows as degraded when upstream is affected
 * - critical: Downstream shows as degraded when upstream is degraded, down when upstream is down
 */
export const ImpactTypeSchema = z.enum([
  "informational",
  "degraded",
  "critical",
]);
export type ImpactType = z.infer<typeof ImpactTypeSchema>;

/**
 * Derived warning state computed from dependency evaluation.
 */
export const DerivedStateSchema = z.enum(["info", "degraded", "down"]);
export type DerivedState = z.infer<typeof DerivedStateSchema>;

// =============================================================================
// HEALTH CHECK RULE
// =============================================================================

/**
 * Optional advanced rule linking a dependency to a specific health check.
 * When rules exist on a dependency, only specified checks trigger the impact.
 */
export const HealthCheckRuleSchema = z.object({
  id: z.string(),
  dependencyId: z.string(),
  healthCheckId: z.string(),
  overrideImpactType: ImpactTypeSchema,
});
export type HealthCheckRule = z.infer<typeof HealthCheckRuleSchema>;

// =============================================================================
// DEPENDENCY ENTITY
// =============================================================================

/**
 * Core dependency entity representing a directional edge between two systems.
 * sourceSystemId (downstream) depends on targetSystemId (upstream).
 */
export const DependencySchema = z.object({
  id: z.string(),
  sourceSystemId: z.string(),
  targetSystemId: z.string(),
  impactType: ImpactTypeSchema,
  transitive: z.boolean(),
  label: z.string().nullable(),
  healthCheckRules: z.array(HealthCheckRuleSchema).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Dependency = z.infer<typeof DependencySchema>;

// =============================================================================
// DEPENDENCY WARNING (Computed, not persisted)
// =============================================================================

/**
 * Information about a single affected upstream system contributing to a warning.
 */
export const AffectedUpstreamSchema = z.object({
  systemId: z.string(),
  systemName: z.string(),
  ownStatus: z.string(),
  impactType: ImpactTypeSchema,
  dependencyLabel: z.string().nullable(),
});
export type AffectedUpstream = z.infer<typeof AffectedUpstreamSchema>;

/**
 * Computed dependency warning for a system.
 * Represents the worst derived state across all upstream dependencies.
 */
export const DependencyWarningSchema = z.object({
  systemId: z.string(),
  derivedState: DerivedStateSchema,
  affectedUpstreams: z.array(AffectedUpstreamSchema),
});
export type DependencyWarning = z.infer<typeof DependencyWarningSchema>;

// =============================================================================
// INPUT SCHEMAS
// =============================================================================

/**
 * Input for creating a health check rule within a dependency.
 */
export const CreateHealthCheckRuleInputSchema = z.object({
  healthCheckId: z.string(),
  overrideImpactType: ImpactTypeSchema,
});

/**
 * Input for creating a new dependency.
 */
export const CreateDependencyInputSchema = z
  .object({
    sourceSystemId: z.string().min(1, "Source system is required"),
    targetSystemId: z.string().min(1, "Target system is required"),
    impactType: ImpactTypeSchema,
    transitive: z.boolean().optional().default(false),
    label: z.string().optional(),
    healthCheckRules: z
      .array(CreateHealthCheckRuleInputSchema)
      .optional()
      .default([]),
  })
  .refine(
    ({ sourceSystemId, targetSystemId }) => sourceSystemId !== targetSystemId,
    { message: "A system cannot depend on itself" },
  );
export type CreateDependencyInput = z.infer<typeof CreateDependencyInputSchema>;

/**
 * Input for updating an existing dependency.
 */
export const UpdateDependencyInputSchema = z.object({
  id: z.string(),
  impactType: ImpactTypeSchema.optional(),
  transitive: z.boolean().optional(),
  label: z.string().nullable().optional(),
  healthCheckRules: z.array(CreateHealthCheckRuleInputSchema).optional(),
});
export type UpdateDependencyInput = z.infer<typeof UpdateDependencyInputSchema>;

// =============================================================================
// NODE POSITION (persisted server-side for the dependency map canvas)
// =============================================================================

/**
 * Persisted node position for the dependency map canvas.
 */
export const NodePositionSchema = z.object({
  systemId: z.string(),
  x: z.number(),
  y: z.number(),
});
export type NodePosition = z.infer<typeof NodePositionSchema>;
