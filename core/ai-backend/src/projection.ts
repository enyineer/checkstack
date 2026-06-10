import { z } from "zod";
import { qualifyAccessRuleId } from "@checkstack/common";
import type {
  AccessRule,
  PluginMetadata,
  ProcedureMetadata,
} from "@checkstack/common";
import { isContractProcedure } from "@orpc/contract";
import type { AnyContractProcedure } from "@orpc/contract";
import type { AuthUser } from "@checkstack/backend-api";
import type { AiToolEffect } from "@checkstack/ai-common";
import type { RegisteredAiTool } from "./tool-registry";

/**
 * Subset of a contract procedure's `~orpc` def that the projection reads. The
 * full def is typed by oRPC; we only narrow what we touch so the projection
 * never depends on undocumented internals.
 */
interface ProjectableProcedureDef {
  meta?: Partial<ProcedureMetadata>;
  inputSchema?: z.ZodType<unknown>;
}

/**
 * Input to {@link buildProjectedTool}. The `procedure` is an existing oRPC
 * contract procedure whose access rules and input schema are read verbatim —
 * nothing is duplicated (decision 2a).
 */
export interface ProjectToolInput<TInput = unknown, TOutput = unknown> {
  /** The contract procedure to project. */
  procedure: AnyContractProcedure;
  /**
   * Plugin metadata that OWNS `procedure`. Used to qualify the procedure's
   * (unqualified) access rules into the same `<plugin>.<resource>.<level>` IDs
   * `autoAuthMiddleware` enforces. For a plugin projecting another plugin's
   * procedure this MUST be the source plugin's metadata, otherwise the gate
   * would check a wrong rule id.
   */
  sourcePluginMetadata: PluginMetadata;
  /** Model-facing description (procedures often lack good model prose). */
  description: string;
  /** Effect classification — REQUIRED, never inferred from operationType. */
  effect: AiToolEffect;
  /** Optional override of the derived tool name (else `<sourcePlugin>.<key>`). */
  name?: string;
  /**
   * Procedure key (e.g. "listIncidents"); used to derive the tool name when
   * `name` is not given.
   */
  procedureKey: string;
  /** The executor — invokes the underlying procedure for the principal. */
  execute(args: { input: TInput; principal: AuthUser }): Promise<TOutput>;
  /** Optional dry-run for mutate / destructive projections (Phase 3). */
  dryRun?: RegisteredAiTool<TInput, TOutput>["dryRun"];
  /**
   * Optional MODEL-FACING result projection (read tools only). The transport
   * still re-enters the live router as the principal and gets the procedure's
   * FULL output (so authz + the audit log are unchanged); this maps that output
   * into a LEANER shape before it enters the model's context window. Use it to
   * drop fields the model does not need (e.g. ids it merely echoes) so verbose
   * rows don't blow the context. The UI / RPC callers are unaffected — only the
   * chat/MCP read-loop applies it. Omit it to send the full output.
   */
  projectResult?: (output: TOutput) => unknown;
}

/**
 * The `execute` a plugin supplies when EXPOSING a read-only projection. A
 * projected read tool is never run via its own `execute`: the MCP transport and
 * the chat read-loop re-enter the live router AS the principal using the tool's
 * `{ pluginId, procedureKey }` routing (so handler-side authz holds). This is a
 * fail-closed safety net if a transport ever forgot to route - it rejects rather
 * than silently running as a trusted service principal.
 */
export function deferredProjectionExecute(): Promise<never> {
  return Promise.reject(
    new Error(
      "Projected read tool execution is routed by the transport (MCP / chat), " +
        "not run via its own execute.",
    ),
  );
}

/**
 * Build a {@link RegisteredAiTool} from an existing oRPC contract procedure.
 *
 * - `requiredAccessRules` is the procedure's `~orpc.meta.access` rules,
 *   qualified against the source plugin id — exactly the IDs the resolver and
 *   `autoAuthMiddleware` compare against `principal.accessRules`.
 * - `input` is the procedure's `~orpc.inputSchema`; a procedure with no input
 *   projects to an empty-object schema.
 * - `effect` is mandatory: this throws if it is omitted (a `mutation`
 *   operationType is NOT the same as a destructive effect).
 */
export function buildProjectedTool<TInput = unknown, TOutput = unknown>(
  input: ProjectToolInput<TInput, TOutput>,
): RegisteredAiTool<TInput, TOutput> {
  const {
    procedure,
    sourcePluginMetadata,
    description,
    effect,
    name,
    procedureKey,
    execute,
    dryRun,
  } = input;

  if (!isContractProcedure(procedure)) {
    throw new Error(
      `Cannot project ${procedureKey}: value is not an oRPC contract procedure.`,
    );
  }
  // `effect` is required by the type, but guard the runtime path for JS callers.
  if (effect === undefined) {
    throw new Error(
      `Cannot project ${procedureKey}: 'effect' is required and is never inferred from the operation type.`,
    );
  }

  const def = (procedure as { "~orpc": ProjectableProcedureDef })["~orpc"];
  const accessRules: AccessRule[] = def.meta?.access ?? [];
  const requiredAccessRules = accessRules.map((rule) =>
    qualifyAccessRuleId(sourcePluginMetadata, rule),
  );

  const inputSchema: z.ZodType<TInput> =
    (def.inputSchema as z.ZodType<TInput> | undefined) ??
    (z.object({}) as unknown as z.ZodType<TInput>);

  const toolName = name ?? `${sourcePluginMetadata.pluginId}.${procedureKey}`;

  return {
    name: toolName,
    description,
    effect,
    input: inputSchema,
    requiredAccessRules,
    dryRun,
    execute,
  };
}
