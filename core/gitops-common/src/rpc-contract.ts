import { createClientDefinition, proc } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";
import { gitopsAccess } from "./access";
import {
  provenanceSchema,
  provenanceStatusSchema,
  deletionPolicySchema,
} from "./provenance-types";
import { secretNameSchema } from "./secret-field";
import { z } from "zod";

export const gitopsContract = {
  // ═══════════════════════════════════════════════════════════════════════════
  // PROVENANCE QUERIES (public read access)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Check if an entity is GitOps-managed. Used by frontends to lock editors. */
  getProvenance: proc({
    operationType: "query",
    userType: "public",
    access: [gitopsAccess.provider.read],
  })
    .input(z.object({
      kind: z.string(),
      /** Look up by envelope entity name. */
      entityName: z.string().optional(),
      /** Look up by plugin-specific entity ID (e.g., catalog system UUID). */
      entityId: z.string().optional(),
    }))
    .output(provenanceSchema.nullable()),

  /** List all provenance entries, optionally filtered by status. */
  listProvenance: proc({
    operationType: "query",
    userType: "public",
    access: [gitopsAccess.provider.read],
  })
    .input(
      z
        .object({
          status: provenanceStatusSchema.optional(),
          providerId: z.string().optional(),
        })
        .optional(),
    )
    .output(z.array(provenanceSchema)),

  // ═══════════════════════════════════════════════════════════════════════════
  // PROVIDER MANAGEMENT (admin)
  // ═══════════════════════════════════════════════════════════════════════════

  /** List all configured providers. */
  listProviders: proc({
    operationType: "query",
    userType: "authenticated",
    access: [gitopsAccess.provider.read],
  }).output(
    z.array(
      z.object({
        id: z.string(),
        type: z.enum(["github", "gitlab"]),
        target: z.string(),
        pathPattern: z.string(),
        baseUrl: z.string().nullable(),
        syncInterval: z.number(),
        deletionPolicy: deletionPolicySchema,
        lastSyncAt: z.date().nullable(),
        lastSyncError: z.string().nullable(),
        createdAt: z.date(),
      }),
    ),
  ),

  /** Create a new GitOps provider. */
  createProvider: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [gitopsAccess.provider.manage],
  })
    .input(
      z.object({
        type: z.enum(["github", "gitlab"]),
        target: z.string().min(1),
        pathPattern: z.string().min(1),
        baseUrl: z.string().optional(),
        authToken: z.string().optional(),
        syncInterval: z.number().int().min(60).optional(),
        deletionPolicy: deletionPolicySchema.optional(),
      }),
    )
    .output(z.object({ id: z.string() })),

  /** Update an existing provider. */
  updateProvider: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [gitopsAccess.provider.manage],
  })
    .input(
      z.object({
        id: z.string(),
        data: z.object({
          target: z.string().min(1).optional(),
          pathPattern: z.string().min(1).optional(),
          baseUrl: z.string().nullable().optional(),
          authToken: z.string().nullable().optional(),
          syncInterval: z.number().int().min(60).optional(),
          deletionPolicy: deletionPolicySchema.optional(),
        }),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  /** Delete a provider and all its provenance entries. */
  deleteProvider: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [gitopsAccess.provider.manage],
  })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Trigger a manual sync for a provider. */
  triggerSync: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [gitopsAccess.provider.manage],
  })
    .input(z.object({ providerId: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Confirm deletion of an orphaned entity. */
  confirmOrphanDeletion: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [gitopsAccess.provider.manage],
  })
    .input(z.object({ provenanceId: z.string() }))
    .output(z.object({ success: z.boolean() })),

  /** Dismiss orphan status (keep entity, remove provenance tracking). */
  dismissOrphan: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [gitopsAccess.provider.manage],
  })
    .input(z.object({ provenanceId: z.string() }))
    .output(z.object({ success: z.boolean() })),

  // ═══════════════════════════════════════════════════════════════════════════
  // SECRET MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /** List secret names (never values). */
  listSecrets: proc({
    operationType: "query",
    userType: "authenticated",
    access: [gitopsAccess.secret.read],
  }).output(
    z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        createdAt: z.date(),
        updatedAt: z.date(),
      }),
    ),
  ),

  /** Create a new secret. */
  createSecret: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [gitopsAccess.secret.manage],
  })
    .input(
      z.object({
        name: secretNameSchema,
        value: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .output(z.object({ id: z.string(), name: z.string() })),

  /** Rotate (update) a secret's value. */
  rotateSecret: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [gitopsAccess.secret.manage],
  })
    .input(
      z.object({
        id: z.string(),
        value: z.string().min(1),
      }),
    )
    .output(z.object({ success: z.boolean() })),

  /** Delete a secret. */
  deleteSecret: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [gitopsAccess.secret.manage],
  })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() })),

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVICE INTERFACE (backend-to-backend)
  // ═══════════════════════════════════════════════════════════════════════════

  /** Resolve a secret by name. Used internally by the reconciliation engine. */
  resolveSecret: proc({
    operationType: "query",
    userType: "service",
    access: [],
  })
    .input(z.object({ name: z.string() }))
    .output(z.object({ value: z.string() })),

  /** Look up which entities reference a given secret. */
  getSecretUsage: proc({
    operationType: "query",
    userType: "authenticated",
    access: [gitopsAccess.secret.read],
  })
    .input(z.object({ secretName: z.string() }))
    .output(
      z.array(
        z.object({
          kind: z.string(),
          entityName: z.string(),
          repository: z.string(),
          filePath: z.string(),
        }),
      ),
    ),

  // ═══════════════════════════════════════════════════════════════════════════
  // KIND REGISTRY (browsing)
  // ═══════════════════════════════════════════════════════════════════════════

  /** List all registered entity kinds with their spec schemas and extensions. */
  listKinds: proc({
    operationType: "query",
    userType: "authenticated",
    access: [gitopsAccess.kinds.read],
  }).output(
    z.array(
      z.object({
        apiVersion: z.string(),
        kind: z.string(),
        specSchema: z.record(z.string(), z.unknown()),
        extensions: z.array(
          z.object({
            namespace: z.string(),
            specSchema: z.record(z.string(), z.unknown()),
          }),
        ),
      }),
    ),
  ),
};

export type GitOpsContract = typeof gitopsContract;

/** Export client definition for type-safe forPlugin usage. */
export const GitOpsApi = createClientDefinition(gitopsContract, pluginMetadata);
