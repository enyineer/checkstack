/**
 * Pure, DOM-free derivation of the chat model picker's options.
 *
 * The dropdown must always offer the connection's `defaultModel` (the prior UI
 * omitted it, so a connection's own default could be unselectable) followed by
 * its `availableModels`, de-duplicated and with the default first. With no
 * `availableModels` the result is just `[defaultModel]` so the picker stays a
 * tidy Select instead of falling back to a free-text field.
 */
export function buildModelOptions({
  defaultModel,
  availableModels,
}: {
  /** The connection's default model id (undefined before an integration loads). */
  defaultModel: string | undefined;
  /** The connection's allowlisted model ids (may be empty/undefined). */
  availableModels: readonly string[] | undefined;
}): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    ordered.push(value);
  };

  // Default first, then the allowlist, de-duplicated.
  add(defaultModel);
  for (const model of availableModels ?? []) add(model);
  return ordered;
}
