import { toJsonSchema } from "@checkstack/backend-api";
import type { AiTool, AiToolDescriptor } from "@checkstack/ai-common";

/**
 * Serialize a registered {@link AiTool} into its transport-facing descriptor.
 *
 * This is the ONE serializer shared by both transports (OpenAI function
 * schemas and MCP tool defs). It wraps the platform's `toJsonSchema()`
 * (which itself wraps zod v4's native `toJSONSchema()` and stamps the `x-*`
 * registry metadata), so the schema a tool exposes is byte-for-byte the same
 * substrate the OpenAPI generator emits for the source procedure — there is no
 * second serializer to drift.
 *
 * The descriptor deliberately carries NO executor closure and NO zod object,
 * only JSON Schema + metadata, so it is safe to return over an RPC or MCP wire.
 */
export function serializeTool({
  tool,
}: {
  tool: AiTool;
}): AiToolDescriptor {
  return {
    name: tool.name,
    description: tool.description,
    effect: tool.effect,
    inputSchema: toJsonSchema(tool.input),
    outputSchema: tool.output ? toJsonSchema(tool.output) : undefined,
    requiredAccessRules: [...tool.requiredAccessRules],
  };
}

/**
 * Serialize many tools at once (convenience for the introspection RPC and the
 * MCP `list_tools` response).
 */
export function serializeTools({
  tools,
}: {
  tools: AiTool[];
}): AiToolDescriptor[] {
  return tools.map((tool) => serializeTool({ tool }));
}
