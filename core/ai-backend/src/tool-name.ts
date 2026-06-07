/**
 * Provider tool-name constraint.
 *
 * LLM providers (and the MCP spec) require tool names to match
 * `^[a-zA-Z0-9_-]+$`.
 */
export const PROVIDER_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Convert a canonical tool name to its provider-safe form.
 *
 * Tool names are qualified as `<plugin>.<tool>` - the "." is the namespace
 * separator of the naming convention, which the provider rejects. It is mapped
 * deterministically to "_" (so `incident.list` -> `incident_list`).
 *
 * Any OTHER disallowed character is an authoring mistake in the tool
 * definition, not stray input, so it is NOT silently rewritten: this throws so
 * the bad name surfaces at registration (startup) instead of being masked.
 *
 * The mapping is applied at the single registration chokepoint (the tool
 * registry) and the projection-routing table, so the registry key, the name
 * sent to the model / MCP client, and the name the model echoes back in a tool
 * call are all identical - the round-trip (name-out === name-in) holds without
 * any reverse lookup.
 */
export function toProviderToolName(name: string): string {
  const normalized = name.replaceAll(".", "_");
  if (!PROVIDER_TOOL_NAME_PATTERN.test(normalized)) {
    throw new Error(
      `Invalid AI tool name "${name}": after normalizing the "." separator to ` +
        `"_" it must match ${String(PROVIDER_TOOL_NAME_PATTERN)} (letters, ` +
        `digits, "_" and "-" only). Rename the tool to use only those ` +
        `characters, with "." reserved for the <plugin>.<tool> separator.`,
    );
  }
  return normalized;
}
