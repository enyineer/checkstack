import { extractErrorMessage } from "@checkstack/common";
import type { Logger } from "@checkstack/backend-api";
import type { RegistryTokenStore } from "./registry-token";

/**
 * The registry request shape shared by the install path (resolver / npmrc
 * renderer) and the live registry-client (search / version lookup): the
 * configured registry URL, scoped-registry overrides, and the resolved
 * plaintext auth token (undefined for an anonymous registry).
 *
 * The token is NEVER returned to the client; it only ever flows into a
 * server-side `.npmrc` (install) or an `Authorization` header (live lookup).
 */
export interface RegistryRequestConfig {
  registryUrl: string;
  scopedRegistries: { scope: string; registryUrl: string }[];
  /** Resolved plaintext token, or undefined for an anonymous registry. */
  authToken?: string;
}

/**
 * Resolve the registry + auth token exactly the way the install path does:
 * read the registry config, look up the stored secret ref, then resolve the
 * plaintext token (platform marker or legacy inline ciphertext) via the
 * token store. A failure to resolve the token is logged and treated as
 * anonymous (the registry may still allow public reads) rather than throwing.
 *
 * Factored out of the inline install wiring so the RPC handlers and the
 * installer share one source of truth for "how do we talk to the registry".
 */
export async function resolveRegistryRequestConfig({
  registry,
  registryToken,
  logger,
}: {
  registry: {
    get(): Promise<{
      registryUrl: string;
      scopedRegistries: { scope: string; registryUrl: string }[];
    }>;
    authSecretRef(): Promise<string | null>;
  };
  registryToken: RegistryTokenStore;
  logger: Logger;
}): Promise<RegistryRequestConfig> {
  const reg = await registry.get();
  const secretRef = await registry.authSecretRef();
  let authToken: string | undefined;
  if (secretRef) {
    try {
      authToken = await registryToken.resolve(secretRef);
    } catch (error) {
      logger.error(
        `Failed to resolve registry auth token: ${extractErrorMessage(error)}`,
      );
    }
  }
  return {
    registryUrl: reg.registryUrl,
    scopedRegistries: reg.scopedRegistries,
    authToken,
  };
}
