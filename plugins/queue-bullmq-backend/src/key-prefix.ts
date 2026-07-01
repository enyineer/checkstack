/**
 * Fold the running instance's NAMESPACE into the configured BullMQ key prefix so
 * two backends that share the SAME redis but run as different instances never
 * see each other's queues, jobs, schedulers or consumer groups. BullMQ keys all
 * derive from this prefix (`${prefix}:${queueName}:...`), so namespacing the
 * prefix namespaces the entire redis key space the instance touches - the queue
 * plugin's config (host/port/db) stays untouched, and the real queue keeps
 * running and testable in a secondary instance.
 *
 * - Default instance (empty namespace): the configured prefix is returned
 *   VERBATIM, so existing deployments are byte-for-byte unchanged.
 * - Secondary instance: the namespace is inserted as its own colon-delimited
 *   segment, e.g. `checkstack:` + `preview` -> `checkstack:preview:`. A trailing
 *   colon on the configured prefix is normalized away first so the result never
 *   contains a doubled `::` separator.
 */
export function composeEffectiveKeyPrefix({
  keyPrefix,
  namespace,
}: {
  keyPrefix: string;
  namespace: string;
}): string {
  if (namespace === "") return keyPrefix;
  const base = keyPrefix.endsWith(":") ? keyPrefix.slice(0, -1) : keyPrefix;
  return `${base}:${namespace}:`;
}
