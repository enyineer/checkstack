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
import type { AuthService } from "@checkstack/backend-api";
import type { AccessRule } from "@checkstack/common";

/**
 * Check if a user has a specific access rule.
 * Supports wildcard (*) for admin access.
 */
function hasAccess(
  user: { accessRules?: string[] },
  accessRule: string
): boolean {
  if (!user.accessRules) return false;
  return (
    user.accessRules.includes("*") || user.accessRules.includes(accessRule)
  );
}

/**
 * Shape of the metadata we surface in the OpenAPI spec as `x-orpc-meta`.
 * `accessRules` are the fully-qualified access rule IDs (e.g.
 * `"catalog.system.read"`), flattened from each procedure's `access`
 * AccessRule[] so doc consumers don't need to know the AccessRule shape.
 */
interface ExposedProcedureMeta {
  userType?: string;
  accessRules?: string[];
}

/**
 * Extract procedure metadata from a contract using oRPC internal structure.
 * Returns the raw `meta` block stored on the contract procedure builder.
 */
function extractRawProcedureMeta(
  contract: unknown
): { userType?: string; access?: AccessRule[] } | undefined {
  const orpcData = (contract as Record<string, unknown>)?.["~orpc"] as
    | { meta?: { userType?: string; access?: AccessRule[] } }
    | undefined;
  return orpcData?.meta;
}

/**
 * Build a lookup map of operationId -> exposed metadata from all contracts.
 * operationId format: "pluginId.procedureName".
 *
 * The procedure metadata stores `access` as AccessRule[]; we flatten it to
 * `accessRules: string[]` of qualified IDs (`{pluginId}.{ruleId}`) so the
 * OpenAPI consumer (API docs UI, third-party clients) gets a plain list.
 */
function buildMetadataLookup(
  contracts: Map<string, AnyContractRouter>
): Map<string, ExposedProcedureMeta> {
  const lookup = new Map<string, ExposedProcedureMeta>();

  for (const [pluginId, contract] of contracts) {
    for (const [procedureName, procedure] of Object.entries(
      contract as Record<string, unknown>
    )) {
      const raw = extractRawProcedureMeta(procedure);
      if (!raw) continue;

      const accessRules = raw.access?.map((rule) => `${pluginId}.${rule.id}`);

      const operationId = `${pluginId}.${procedureName}`;
      lookup.set(operationId, {
        userType: raw.userType,
        ...(accessRules && accessRules.length > 0 ? { accessRules } : {}),
      });
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
      title: "Checkstack API",
      version: "1.0.0",
      description: "API documentation for Checkstack platform endpoints.",
    },
    servers: [{ url: baseUrl }],
  })) as {
    paths?: Record<
      string,
      Record<string, { operationId?: string; "x-orpc-meta"?: unknown }>
    >;
  };

  // Post-process: Add x-orpc-meta to each operation and prefix paths with /rest.
  // The REST handler is mounted at /rest/:pluginId/* (see api-router.ts);
  // /api/:pluginId/* serves oRPC's native wire protocol, not REST.
  if (spec.paths) {
    const prefixedPaths: typeof spec.paths = {};

    for (const [path, methods] of Object.entries(spec.paths)) {
      const prefixedPath = `/rest${path.startsWith("/") ? path : `/${path}`}`;
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
  requiredAccessRule,
}: {
  pluginManager: PluginManager;
  authService: AuthService;
  baseUrl: string;
  requiredAccessRule: string;
}): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    // Authenticate request
    const user = await authService.authenticate(req);

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check access rule (applications.manage from auth plugin)
    // Services don't have accesss, so deny them access to docs
    if (user.type === "service" || !hasAccess(user, requiredAccessRule)) {
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
