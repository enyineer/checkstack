/**
 * Pick the `SourceConfigSlot` filler that provides a bespoke config editor for
 * a given source type. A filler declares which type it implements in its
 * `metadata.sourceTypeId`; the host renders the FIRST filler whose metadata
 * matches (deterministic on registration order) and falls back to the generic
 * DynamicForm when none matches. Kept pure so the matching is unit-testable
 * without the plugin registry or a DOM.
 */
export function selectConfigFiller<
  E extends { metadata?: { sourceTypeId?: string } | undefined },
>({
  extensions,
  sourceTypeId,
}: {
  extensions: readonly E[];
  sourceTypeId: string;
}): E | null {
  return (
    extensions.find((ext) => ext.metadata?.sourceTypeId === sourceTypeId) ??
    null
  );
}
