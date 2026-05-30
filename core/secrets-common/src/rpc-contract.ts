import { createClientDefinition, proc } from "@checkstack/common";
import { z } from "zod";
import { pluginMetadata } from "./plugin-metadata";
import { secretsAccess } from "./access";
import { secretNameSchema } from "./secret-field";
import { secretMetadataSchema } from "./metadata";

/**
 * Secrets platform RPC contract.
 *
 * Hard rule: NO endpoint ever returns a secret VALUE to a browser client.
 * `listSecrets` returns metadata only (`hasValue`, never the value);
 * `listSecretNames` returns names only. Resolution to values is a
 * service-typed, internal `secretResolverRef` method, not part of this
 * contract.
 */
export const secretsContract = {
  /** List secrets as metadata only (names, descriptions, `hasValue`). */
  listSecrets: proc({
    operationType: "query",
    userType: "authenticated",
    access: [secretsAccess.secret.read],
  }).output(z.array(secretMetadataSchema)),

  /**
   * List secret names only. Used by the editor `${{ secrets.* }}`
   * autocomplete and the secret→env mapping UI. Never returns values.
   */
  listSecretNames: proc({
    operationType: "query",
    userType: "authenticated",
    access: [secretsAccess.secret.read],
  }).output(z.array(z.string())),

  /**
   * Create or rotate a secret. Write-only: the value is accepted as input
   * and stored encrypted; it is never returned by any endpoint. If a
   * secret with `name` already exists its value is rotated.
   */
  setSecret: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [secretsAccess.secret.manage],
  })
    .input(
      z.object({
        name: secretNameSchema,
        value: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .output(z.object({ id: z.string(), name: z.string() })),

  /** Delete a secret by name. */
  deleteSecret: proc({
    operationType: "mutation",
    userType: "authenticated",
    access: [secretsAccess.secret.manage],
  })
    .route({ method: "DELETE" })
    .input(z.object({ name: secretNameSchema }))
    .output(z.object({ success: z.boolean() })),

  /**
   * Active backend configuration (metadata only). Never returns backend
   * auth credentials. Vault config UI lands in a later phase.
   */
  getBackendConfig: proc({
    operationType: "query",
    userType: "authenticated",
    access: [secretsAccess.secret.read],
  }).output(
    z.object({
      activeBackend: z.string(),
      availableBackends: z.array(z.string()),
    }),
  ),
};

export type SecretsContract = typeof secretsContract;

/** Type-safe client definition for `forPlugin` usage. */
export const SecretsApi = createClientDefinition(secretsContract, pluginMetadata);
