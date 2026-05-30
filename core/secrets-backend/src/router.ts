import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import { secretsContract } from "@checkstack/secrets-common";
import { extractErrorMessage } from "@checkstack/common";
import type { SecretBackendRegistry } from "./secret-backend-registry";
import { createSecretAdminService } from "./admin-service";

const os = implement(secretsContract)
  .$context<RpcContext>()
  .use(correlationMiddleware)
  .use(autoAuthMiddleware);

export interface SecretsRouterDeps {
  backends: SecretBackendRegistry;
  /** Resolve the currently active backend id. */
  getActiveBackendId: () => Promise<string>;
  /** Notify consumers (e.g. gitops) that a secret changed. */
  emitChanged: (input: {
    name: string;
    change: "created" | "rotated" | "deleted";
  }) => Promise<void>;
}

export function createSecretsRouter({
  backends,
  getActiveBackendId,
  emitChanged,
}: SecretsRouterDeps) {
  // The router shares the admin service so write semantics + change events
  // stay identical whether a secret is managed via the central UI or via a
  // consumer plugin (e.g. gitops) delegating to secretAdminRef.
  const admin = createSecretAdminService({
    getActiveBackend: async () => backends.get(await getActiveBackendId()),
    onChanged: emitChanged,
  });

  const listSecrets = os.listSecrets.handler(async () => {
    // Metadata only — never values.
    return admin.list();
  });

  const listSecretNames = os.listSecretNames.handler(async () => {
    const metadata = await admin.list();
    return metadata.map((m) => m.name);
  });

  const setSecret = os.setSecret.handler(async ({ input, context }) => {
    const actor = context.user;
    const createdBy =
      actor && actor.type !== "service" ? actor.id : undefined;

    try {
      await admin.setSecret({
        name: input.name,
        value: input.value,
        description: input.description,
        createdBy,
      });
    } catch (error) {
      throw new ORPCError("NOT_IMPLEMENTED", {
        message: extractErrorMessage(error),
      });
    }

    const after = await admin.list();
    const meta = after.find((m) => m.name === input.name);
    return { id: meta?.id ?? input.name, name: input.name };
  });

  const deleteSecret = os.deleteSecret.handler(async ({ input }) => {
    try {
      await admin.deleteSecret({ name: input.name });
    } catch (error) {
      throw new ORPCError("NOT_IMPLEMENTED", {
        message: extractErrorMessage(error),
      });
    }
    return { success: true };
  });

  const getBackendConfig = os.getBackendConfig.handler(async () => {
    return {
      activeBackend: await getActiveBackendId(),
      availableBackends: backends.ids(),
    };
  });

  return os.router({
    listSecrets,
    listSecretNames,
    setSecret,
    deleteSecret,
    getBackendConfig,
  });
}
