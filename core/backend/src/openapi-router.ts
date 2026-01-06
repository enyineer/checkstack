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
import type { ProcedureMetadata } from "@checkmate/common";
import type { PluginManager } from "./plugin-manager";
import type { AuthService } from "@checkmate/backend-api";

// Application-accessible user types for OpenAPI filtering
const APPLICATION_ACCESSIBLE_USER_TYPES = ["authenticated", "public"] as const;

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
 * Generate OpenAPI specification from registered plugin contracts.
 * Filters to only include endpoints accessible by external applications.
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

  // Create OpenAPI generator with Zod v4 converter
  const generator = new OpenAPIGenerator({
    schemaConverters: [new ZodToJsonSchemaConverter()],
  });

  // Generate spec with filtering for application-accessible endpoints
  const spec = await generator.generate(aggregatedContract, {
    info: {
      title: "Checkmate API",
      version: "1.0.0",
      description:
        "API documentation for Checkmate platform endpoints accessible by external applications.",
    },
    servers: [{ url: baseUrl }],
    // Filter to only include application-accessible endpoints
    filter: ({ contract }) => {
      // Access the internal oRPC structure to get metadata
      const orpcData = (contract as unknown as Record<string, unknown>)[
        "~orpc"
      ] as { meta?: ProcedureMetadata } | undefined;

      const userType = orpcData?.meta?.userType;

      // Include only authenticated or public endpoints
      return (
        userType !== undefined &&
        APPLICATION_ACCESSIBLE_USER_TYPES.includes(
          userType as (typeof APPLICATION_ACCESSIBLE_USER_TYPES)[number]
        )
      );
    },
  });

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
