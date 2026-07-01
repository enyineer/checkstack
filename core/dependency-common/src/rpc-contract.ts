import { z } from "zod";
import { createClientDefinition, proc } from "@checkstack/common";
import { dependencyAccess } from "./access";
import { pluginMetadata } from "./plugin-metadata";
import {
  DependencySchema,
  DependencyWarningSchema,
  CreateDependencyInputSchema,
  UpdateDependencyInputSchema,
  NodePositionSchema,
} from "./schemas";

export const dependencyContract = {
  // ==========================================================================
  // READ ENDPOINTS (public - accessible by anyone with read access)
  // ==========================================================================

  /** Get all dependencies for a system (both directions) */
  getDependencies: proc({
    operationType: "query",
    userType: "public",
    access: [dependencyAccess.dependency.read],
    instanceAccess: { idParam: "systemId" },
  })
    .input(
      z.object({
        systemId: z.string(),
        direction: z
          .enum(["upstream", "downstream", "both"])
          .optional()
          .default("both"),
      }),
    )
    .output(z.object({ dependencies: z.array(DependencySchema) })),

  /**
   * Get the full dependency graph (all dependencies, for the canvas).
   * Gated by the map rule - the full topology is map-only, not public.
   */
  getAllDependencies: proc({
    operationType: "query",
    userType: "public",
    access: [dependencyAccess.map],
  }).output(z.object({ dependencies: z.array(DependencySchema) })),

  /** Bulk-fetch derived warnings for multiple systems (for dashboard badges) */
  getWarnings: proc({
    operationType: "query",
    userType: "public",
    access: [dependencyAccess.dependency.read],
    instanceAccess: { recordKey: "warnings" },
  })
    .route({ method: "POST" })
    .input(z.object({ systemIds: z.array(z.string()) }))
    .output(
      z.object({
        warnings: z.record(z.string(), DependencyWarningSchema),
      }),
    ),

  /** Get dependency warnings for a single system */
  getWarningsForSystem: proc({
    operationType: "query",
    userType: "public",
    access: [dependencyAccess.dependency.read],
    instanceAccess: { idParam: "systemId" },
  })
    .input(z.object({ systemId: z.string() }))
    .output(DependencyWarningSchema.nullable()),

  // ==========================================================================
  // MANAGEMENT ENDPOINTS (authenticated with manage access)
  // ==========================================================================

  /** Create a new dependency with cycle detection */
  createDependency: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [dependencyAccess.dependency.manage],
    // A dependency edge is authorized by MANAGE on its SOURCE system (the target
    // is not access-checked). Scope on the `catalog.system` parent so a team
    // that manages the source system may edit its dependencies without the
    // global `dependency.manage` rule. (An `idParam` here would wrongly look for
    // a `dependency` grant keyed by the system id, which never exists.)
    instanceAccess: {
      parentScope: {
        resourceType: "catalog.system",
        action: "manage",
        idParam: "sourceSystemId",
      },
    },
  })
    .input(CreateDependencyInputSchema)
    .output(DependencySchema),

  /** Update an existing dependency */
  updateDependency: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [dependencyAccess.dependency.manage],
    // Authorized by MANAGE on the source system (`systemId`).
    instanceAccess: {
      parentScope: {
        resourceType: "catalog.system",
        action: "manage",
        idParam: "systemId",
      },
    },
  })
    .route({ method: "PATCH" })
    .input(UpdateDependencyInputSchema)
    .output(DependencySchema),

  /** Delete a dependency */
  deleteDependency: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [dependencyAccess.dependency.manage],
    // Authorized by MANAGE on the source system (`systemId`).
    instanceAccess: {
      parentScope: {
        resourceType: "catalog.system",
        action: "manage",
        idParam: "systemId",
      },
    },
  })
    .route({ method: "DELETE" })
    .input(z.object({ id: z.string(), systemId: z.string() }))
    .output(z.object({ success: z.boolean() })),

  // ==========================================================================
  // NODE POSITIONS (authenticated - per-user canvas layout persistence)
  // Gated by the map rule - canvas layout only matters to map viewers.
  // ==========================================================================

  /** Get saved node positions for the dependency map canvas */
  getNodePositions: proc({
    operationType: "query",
    userType: "user",
    access: [dependencyAccess.map],
  }).output(z.object({ positions: z.array(NodePositionSchema) })),

  /** Save node positions for the dependency map canvas */
  saveNodePositions: proc({
    operationType: "mutation",
    userType: "user",
    access: [dependencyAccess.map],
  })
    .input(z.object({ positions: z.array(NodePositionSchema) }))
    .output(z.object({ success: z.boolean() })),
};

// Export contract type
export type DependencyContract = typeof dependencyContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(DependencyApi);
export const DependencyApi = createClientDefinition(
  dependencyContract,
  pluginMetadata,
);
