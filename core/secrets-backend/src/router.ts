import { implement, ORPCError } from "@orpc/server";
import {
  autoAuthMiddleware,
  correlationMiddleware,
  type RpcContext,
} from "@checkstack/backend-api";
import {
  secretsContract,
  type BackendConfigDto,
  type SetBackendConfigInput,
} from "@checkstack/secrets-common";
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
  /** Persist the active backend id. */
  setActiveBackendId: (id: string) => Promise<void>;
  /** Notify consumers (e.g. gitops) that a secret changed. */
  emitChanged: (input: {
    name: string;
    change: "created" | "rotated" | "deleted";
  }) => Promise<void>;
}

export function createSecretsRouter({
  backends,
  getActiveBackendId,
  setActiveBackendId,
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
    const activeBackend = await getActiveBackendId();
    const dto: BackendConfigDto = {
      activeBackend,
      availableBackends: backends.ids(),
    };
    // Surface the active backend's connection metadata (never credentials).
    const active = backends.has(activeBackend)
      ? backends.get(activeBackend)
      : undefined;
    if (active?.getConfigMeta) {
      dto.vault = await active.getConfigMeta();
    }
    return dto;
  });

  const setBackendConfig = os.setBackendConfig.handler(async ({ input }) => {
    // Configure the target backend (e.g. Vault address/auth/credential)
    // BEFORE switching to it, so we never activate an unconfigured backend.
    if (input.vault) {
      const target = backends.has(input.activeBackend)
        ? backends.get(input.activeBackend)
        : undefined;
      if (!target?.configure) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Backend "${input.activeBackend}" is not configurable.`,
        });
      }
      const vault: NonNullable<SetBackendConfigInput["vault"]> = input.vault;
      await target.configure(vault);
    }
    if (!backends.has(input.activeBackend)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Backend "${input.activeBackend}" is not registered.`,
      });
    }
    await setActiveBackendId(input.activeBackend);
    return { success: true };
  });

  const testBackend = os.testBackend.handler(async ({ input }) => {
    const id = input.backend ?? (await getActiveBackendId());
    if (!backends.has(id)) {
      return { ok: false, message: `Backend "${id}" is not registered.` };
    }
    const backend = backends.get(id);
    // A backend with no external connectivity (e.g. local) is always ok.
    if (!backend.test) {
      return { ok: true, message: `Backend "${id}" requires no connectivity.` };
    }
    try {
      return await backend.test();
    } catch (error) {
      return { ok: false, message: extractErrorMessage(error) };
    }
  });

  return os.router({
    listSecrets,
    listSecretNames,
    setSecret,
    deleteSecret,
    getBackendConfig,
    setBackendConfig,
    testBackend,
  });
}
