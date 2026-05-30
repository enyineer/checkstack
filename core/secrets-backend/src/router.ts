import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import { secretsContract } from "@checkstack/secrets-common";
import type { SecretBackend } from "./secret-backend";
import type { SecretBackendRegistry } from "./secret-backend-registry";

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
  const active = async (): Promise<SecretBackend> =>
    backends.get(await getActiveBackendId());

  const listSecrets = os.listSecrets.handler(async () => {
    const backend = await active();
    // Metadata only — never values.
    return backend.list();
  });

  const listSecretNames = os.listSecretNames.handler(async () => {
    const backend = await active();
    const metadata = await backend.list();
    return metadata.map((m) => m.name);
  });

  const setSecret = os.setSecret.handler(async ({ input, context }) => {
    const backend = await active();
    if (!backend.set) {
      throw new ORPCError("NOT_IMPLEMENTED", {
        message: `Backend "${backend.id}" is read-only; secrets must be managed in the external store.`,
      });
    }

    const existing = await backend.list();
    const already = existing.find((m) => m.name === input.name);

    const actor = context.user;
    const createdBy =
      actor && actor.type !== "service" ? actor.id : undefined;

    await backend.set({
      name: input.name,
      value: input.value,
      description: input.description,
      createdBy,
    });

    await emitChanged({
      name: input.name,
      change: already ? "rotated" : "created",
    });

    // Re-read metadata to return the stable id (never the value).
    const after = await backend.list();
    const meta = after.find((m) => m.name === input.name);
    return { id: meta?.id ?? input.name, name: input.name };
  });

  const deleteSecret = os.deleteSecret.handler(async ({ input }) => {
    const backend = await active();
    if (!backend.delete) {
      throw new ORPCError("NOT_IMPLEMENTED", {
        message: `Backend "${backend.id}" is read-only; secrets must be managed in the external store.`,
      });
    }
    await backend.delete({ name: input.name });
    await emitChanged({ name: input.name, change: "deleted" });
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
