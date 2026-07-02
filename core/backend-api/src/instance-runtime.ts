import { z } from "zod";

/**
 * The instance NAMESPACE isolates a running backend from other backends that
 * share the same external infrastructure (redis/BullMQ key space, and any
 * future shared cache/topic/consumer-group). Two backends pointed at the same
 * redis but carrying different namespaces must never see each other's queue
 * jobs, schedulers, or cached values.
 *
 * The default (production / normal dev) instance carries the EMPTY namespace
 * (`""`). A non-empty namespace marks a secondary instance - e.g. the
 * `preview` instance the PR-preview tool boots alongside the dev instance.
 *
 * A namespace is a short, url/key-safe slug so it can be folded verbatim into
 * a redis key prefix, a queue name, a consumer-group id, etc.:
 *
 * - 1-32 chars, lowercase letters / digits / hyphens, starting with an
 *   alphanumeric (`/^[a-z0-9][a-z0-9-]{0,31}$/`), OR
 * - the empty string `""` for the default instance.
 */
export const instanceNamespaceSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/)
  .or(z.literal(""));

/**
 * Runtime handle exposed to every plugin (core and runtime-installed) via
 * `coreServices.instanceRuntime`. It tells a plugin which instance it is
 * running as so it can NAMESPACE any resource it keeps on shared external
 * infrastructure.
 *
 * ## Plugin-author contract
 *
 * A plugin that stores state on infrastructure SHARED across instances (a redis
 * key space, a message topic, a consumer group, a shared cache) MUST fold
 * {@link InstanceRuntime.namespace} into the key/name it uses, so a secondary
 * instance cannot collide with or read the default instance's state. Namespace
 * rather than suppress: user-visible behaviour (notifications, integrations, AI,
 * probes) keeps running in a secondary instance - only the shared *keys* change.
 * Fall back / pause only where namespacing is genuinely impossible (e.g. an
 * exclusive remote resource that cannot be keyed), and make that visible.
 *
 * Anything backed by the instance's own Postgres database needs no namespacing:
 * a secondary instance runs against its own (copied) database.
 */
export interface InstanceRuntime {
  /**
   * The instance namespace. `""` for the default instance; a non-empty slug
   * (see {@link instanceNamespaceSchema}) for a secondary instance.
   */
  readonly namespace: string;
  /** `true` when this is the default instance (empty namespace). */
  readonly isDefault: boolean;
}

/**
 * Normalize and validate a raw namespace value (typically
 * `process.env.CHECKSTACK_INSTANCE_NAMESPACE`). Unset / blank yields the
 * default (empty) namespace. A provided value is trimmed and lowercased, then
 * validated against {@link instanceNamespaceSchema}; an invalid value throws so
 * a misconfigured secondary instance fails fast rather than silently colliding.
 */
export function parseInstanceNamespace(raw: string | undefined | null): string {
  const normalized = (raw ?? "").trim().toLowerCase();
  const result = instanceNamespaceSchema.safeParse(normalized);
  if (!result.success) {
    throw new Error(
      `Invalid instance namespace "${raw}": must be 1-32 chars of ` +
        `lowercase letters, digits, or hyphens, starting with a letter or ` +
        `digit (/^[a-z0-9][a-z0-9-]{0,31}$/). Leave it unset for the default ` +
        `instance.`,
    );
  }
  return result.data;
}

/** Build an {@link InstanceRuntime} from an already-validated namespace. */
export function createInstanceRuntime({
  namespace,
}: {
  namespace: string;
}): InstanceRuntime {
  return { namespace, isDefault: namespace === "" };
}
