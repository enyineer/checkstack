import { z } from "zod";

/**
 * Effect classification for an AI tool. REQUIRED on every tool and never
 * inferred from the procedure verb — a `mutation` operationType is not the
 * same as a destructive effect.
 *
 * - `read`: pure read; auto-runs in chat and over MCP.
 * - `mutate`: changes state; gated behind the two-step propose -> apply flow
 *   (Phase 3).
 * - `destructive`: irreversible state change; same propose -> apply gate, with
 *   stronger confirmation UX.
 */
export const AiToolEffectSchema = z.enum(["read", "mutate", "destructive"]);
export type AiToolEffect = z.infer<typeof AiToolEffectSchema>;

/**
 * One changed field in a before -> after diff, surfaced on a confirm/applied card
 * so the operator always sees exactly WHAT changed (especially for updates), in
 * both approve and auto modes. `path` is a dotted field path; a `before` of
 * `undefined` means the field was added, an `after` of `undefined` means removed.
 */
export interface AiFieldDiff {
  path: string;
  before: unknown;
  after: unknown;
}

/**
 * Human-readable preview returned by a tool's `dryRun` and shown on a confirm
 * card (chat) or returned for a follow-up `apply` call (MCP). Phase 3 consumes
 * the `payload`; Phase 1 only defines the shape.
 */
export interface AiProposalPreview<TPayload = unknown> {
  /** One-line, model/human-facing summary of what `apply` will do. */
  summary: string;
  /** The validated, ready-to-apply payload captured at propose time. */
  payload: TPayload;
  /**
   * Optional before -> after diff for an UPDATE proposal. Surfaced on the confirm
   * card (approve mode) and the applied card (auto mode) so a change is always
   * visible. Omit for a create (the whole payload is new).
   */
  diff?: AiFieldDiff[];
}

/**
 * A transport-agnostic, callable AI tool — the spine of the AI platform.
 *
 * The same descriptor backs both transports: the internal chat agent loop
 * (Phase 4) and the external MCP server (Phase 2/3). Its `input` zod schema is
 * serialized to JSON Schema for both OpenAI function calling and MCP tool defs
 * via the shared `toJsonSchema()` serializer — there is no second serializer.
 *
 * @template TInput  - validated tool input
 * @template TOutput - tool result shape
 * @template TPrincipal - the authenticated caller; the backend supplies the
 *   concrete `AuthUser` type. Kept generic here so `ai-common` does not depend
 *   on `@checkstack/backend-api`.
 */
export interface AiTool<
  TInput = unknown,
  TOutput = unknown,
  TPrincipal = unknown,
  TRpc = unknown,
> {
  /** Auto-qualified by plugin id on registration, e.g. "automation.propose". */
  name: string;
  /** Model-facing description (becomes the OpenAI / MCP tool description). */
  description: string;
  /** zod input; serialized to JSON Schema via `toJsonSchema()` for both transports. */
  input: z.ZodType<TInput>;
  /** Optional zod output; documents the tool result shape to the model. */
  output?: z.ZodType<TOutput>;
  /** Effect classification. REQUIRED. Never inferred from the verb. */
  effect: AiToolEffect;
  /**
   * Fully-qualified access-rule IDs the principal must satisfy to see/call
   * this tool. SAME vocabulary as OAuth scopes AND the `autoAuthMiddleware`
   * access-rule IDs (`<pluginId>.<resource>.<level>`).
   */
  requiredAccessRules: string[];
  /**
   * For mutate / destructive tools: optional dry-run used by `propose` (Phase
   * 3). Returns a human-readable summary plus the validated payload to apply.
   * Read tools never define this.
   */
  dryRun?(args: {
    input: TInput;
    principal: TPrincipal;
    /** USER-scoped RPC client (see `execute`); use it for any plugin call. */
    rpcClient: TRpc;
  }): Promise<AiProposalPreview>;
  /**
   * The actual call. For mutate / destructive tools this is only reached via
   * `apply` (Phase 3); read tools call it directly.
   *
   * `rpcClient` is a USER-SCOPED client bound to the ORIGINATING user: any
   * plugin procedure it calls re-enters the live router as that user, so
   * handler-side authorization (access rules AND per-resource/team scoping) is
   * enforced exactly as a direct UI/RPC call. A tool MUST use this client for
   * plugin calls; it must NEVER capture a trusted service client, which would
   * bypass the user's authorization and broaden access.
   */
  execute(args: {
    input: TInput;
    principal: TPrincipal;
    rpcClient: TRpc;
  }): Promise<TOutput>;
}

/**
 * Serialized, transport-facing view of a tool (no executors, no zod). This is
 * what introspection RPCs and the MCP tool list return — it carries the JSON
 * Schema for the input, never any executor closure.
 */
export const AiToolDescriptorSchema = z.object({
  name: z.string(),
  description: z.string(),
  effect: AiToolEffectSchema,
  /** Input JSON Schema (produced by `toJsonSchema()`). */
  inputSchema: z.record(z.string(), z.unknown()),
  /** Output JSON Schema, when the tool declares an `output`. */
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  requiredAccessRules: z.array(z.string()),
});
export type AiToolDescriptor = z.infer<typeof AiToolDescriptorSchema>;
