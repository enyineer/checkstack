/**
 * OpenAPI Router - Exposes OpenAPI specification for external applications.
 *
 * This router provides a `/api/openapi.json` endpoint that returns the
 * aggregated OpenAPI specification for all endpoints accessible by
 * external applications (userType: "authenticated" | "public").
 */
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import type { AnyContractRouter } from "@orpc/contract";
import type { PluginManager } from "./plugin-manager";
import type { AuthService } from "@checkmate/backend-api";

/**
 * Check if a user has a specific permission.
 * Supports wildcard (*) for admin access.
 */
function hasPermission(
  user: { permissions?: string[] },
  permission: string
): boolean {
  if (!user.permissions) return false;
  return (
    user.permissions.includes("*") || user.permissions.includes(permission)
  );
}

/**
 * Extract procedure metadata from a contract using oRPC internal structure.
 */
function extractProcedureMetadata(
  contract: unknown
): { userType?: string; permissions?: string[] } | undefined {
  const orpcData = (contract as Record<string, unknown>)?.["~orpc"] as
    | { meta?: { userType?: string; permissions?: string[] } }
    | undefined;
  return orpcData?.meta;
}

/**
 * Build a lookup map of operationId -> metadata from all contracts.
 * operationId format: "pluginId.procedureName"
 */
function buildMetadataLookup(
  contracts: Map<string, AnyContractRouter>
): Map<string, { userType?: string; permissions?: string[] }> {
  const lookup = new Map<
    string,
    { userType?: string; permissions?: string[] }
  >();

  for (const [pluginId, contract] of contracts) {
    // Contract is an object with procedure names as keys
    for (const [procedureName, procedure] of Object.entries(
      contract as Record<string, unknown>
    )) {
      const meta = extractProcedureMetadata(procedure);
      if (meta) {
        const operationId = `${pluginId}.${procedureName}`;
        lookup.set(operationId, meta);
      }
    }
  }

  return lookup;
}

/**
 * Generate OpenAPI specification from registered plugin contracts.
 * Returns all endpoints with their userType metadata visible as x-orpc-meta.
 */
export async function generateOpenApiSpec({
  pluginManager,
  baseUrl,
}: {
  pluginManager: PluginManager;
  baseUrl: string;
}): Promise<Record<string, unknown>> {
  const contracts = pluginManager.getAllContracts();

  // Build aggregated contract object: { pluginId: contract, ... }
  const aggregatedContract: Record<string, AnyContractRouter> = {};
  for (const [pluginId, contract] of contracts) {
    aggregatedContract[pluginId] = contract;
  }

  // Build metadata lookup from contracts
  const metadataLookup = buildMetadataLookup(contracts);

  // Create OpenAPI generator with Zod v4 converter
  const generator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });

  // Generate spec for all endpoints
  const spec = (await generator.generate(aggregatedContract, {
    info: {
      title: "Checkmate API",
      version: "1.0.0",
      description: "API documentation for Checkmate platform endpoints.",
    },
    servers: [{ url: baseUrl }],
  })) as {
    paths?: Record<
      string,
      Record<string, { operationId?: string; "x-orpc-meta"?: unknown }>
    >;
  };

  // Post-process: Add x-orpc-meta to each operation and prefix paths with /api
  if (spec.paths) {
    const prefixedPaths: typeof spec.paths = {};

    for (const [path, methods] of Object.entries(spec.paths)) {
      // Prefix path with /api
      const prefixedPath = `/api${path.startsWith("/") ? path : `/${path}`}`;
      prefixedPaths[prefixedPath] = methods;

      // Add metadata to each operation
      for (const operation of Object.values(methods)) {
        if (operation.operationId) {
          const meta = metadataLookup.get(operation.operationId);
          if (meta) {
            operation["x-orpc-meta"] = meta;
          }
        }
      }
    }

    spec.paths = prefixedPaths;
  }

  return spec as Record<string, unknown>;
}

/**
 * Create the OpenAPI endpoint handler for Hono.
 * Returns a fetch handler that serves the OpenAPI spec.
 */
export function createOpenApiHandler({
  pluginManager,
  authService,
  baseUrl,
  requiredPermission,
}: {
  pluginManager: PluginManager;
  authService: AuthService;
  baseUrl: string;
  requiredPermission: string;
}): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    // Authenticate request
    const user = await authService.authenticate(req);

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check permission (applications.manage from auth plugin)
    // Services don't have permissions, so deny them access to docs
    if (user.type === "service" || !hasPermission(user, requiredPermission)) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      const spec = await generateOpenApiSpec({ pluginManager, baseUrl });

      return Response.json(spec);
    } catch (error) {
      console.error("Failed to generate OpenAPI spec:", error);
      return Response.json(
        { error: "Failed to generate OpenAPI specification" },
        { status: 500 }
      );
    }
  };
}
