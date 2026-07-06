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
 * A dependency scope cell: which slice of the upstream (target) system this
 * edge watches, and at what severity. Each cell is a `(healthCheckId?,
 * environmentId?, severity)` tuple - the "matrix" that lets an edge depend on
 * only a specific check and/or a specific environment of the target.
 *
 * - `healthCheckId` = a target configuration id, or `null` for "any check".
 * - `environmentId` = a target environment id, or `null` for "any environment"
 *   (the target's cross-environment rollup).
 * - `overrideImpactType` = the severity applied when this slice is affected.
 *
 * When a dependency has ANY cells, ONLY those slices are watched (they replace
 * the whole-system watch). With NO cells, the edge watches the target's overall
 * rollup at the edge's own `impactType` - the default "depend on any check in
 * any environment" behaviour.
 *
 * NOTE: kept named `HealthCheckRule` / `healthCheckRules` for wire and storage
 * compatibility; conceptually it is a scope cell.
 */
export const HealthCheckRuleSchema = z.object({
  id: z.string(),
  dependencyId: z.string(),
  /** Target configuration id, or `null` for "any check". */
  healthCheckId: z.string().nullable(),
  /** Target environment id, or `null` for "any environment" (rollup). */
  environmentId: z.string().nullable(),
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
 * Input for creating a dependency scope cell. Both scoping axes are optional
 * and default to `null` ("any"), so an env-only cell omits `healthCheckId`, a
 * check-only cell omits `environmentId`, and a cell can pin both.
 */
export const CreateHealthCheckRuleInputSchema = z.object({
  healthCheckId: z.string().nullable().optional().default(null),
  environmentId: z.string().nullable().optional().default(null),
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
  systemId: z.string(),
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
