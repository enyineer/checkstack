import { extractErrorMessage } from "@checkstack/common";
import type { AuthUser, EventBus, RpcClient } from "@checkstack/backend-api";
import type { AiFieldDiff } from "@checkstack/ai-common";
import type { AiToolResolver } from "../resolver";
import type { RegisteredAiTool } from "../tool-registry";
import type { AiToolRegistry } from "../tool-registry";
import { aiHooks } from "../hooks";
import { hashToolArgs } from "./args-hash";
import type { AiToolCallStore, AuditPrincipal } from "./store";
import {
  formatProposalToken,
  nonceMatches,
  parseProposalToken,
} from "./token";

/** Errors a transport maps to an appropriate status code. */
export type ProposeApplyErrorCode =
  | "forbidden" // resolver/authz gate refused
  | "not_found" // unknown tool / token row
  | "not_proposable" // tool has no dryRun (read tool or misconfigured mutate)
  | "invalid_token" // malformed token / nonce mismatch
  | "expired" // TTL elapsed (or row already swept to expired)
  | "consumed" // already applied/rejected — single-use violated
  | "execute_failed"; // apply's execute threw

export class ProposeApplyError extends Error {
  constructor(
    public readonly code: ProposeApplyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProposeApplyError";
  }
}

export interface ProposeResult {
  /** Opaque proposal token (`propose:<rowId>.<nonce>`). */
  token: string;
  /** Human/model-facing one-line summary of what `apply` will do. */
  summary: string;
  /** The validated, ready-to-apply payload (for the chat confirm card). */
  payload: unknown;
  /** Optional before -> after diff for an update (shown on the card). */
  diff?: AiFieldDiff[];
  /** Audit row id (== the rowId inside the token). */
  toolCallId: string;
  /** Hard expiry of the proposal. */
  expiresAt: Date;
}

export interface ApplyResult {
  toolCallId: string;
  result: unknown;
}

/**
 * Read-only description of a proposal, resolved from its token WITHOUT consuming
 * it. Powers the post-confirm-card acknowledgment turn (the model reacting to a
 * human apply/decline): the caller needs the tool name + stored summary + the
 * owning conversation + current status, but must NOT apply anything. The nonce
 * is verified so a guessed/forged token reveals nothing.
 */
export interface ProposalDescription {
  rowId: string;
  toolName: string;
  /** Lifecycle status: proposed | applied | rejected | expired | failed. */
  status: string;
  /** The chat conversation the proposal was created in (if any). */
  conversationId?: string;
  /** The one-line summary captured at propose time (resultSnapshot.summary). */
  summary?: string;
}

interface ProposeApplyDeps {
  registry: AiToolRegistry;
  resolver: AiToolResolver;
  store: AiToolCallStore;
  /** Optional bus; when present, `ai.toolCalled` is emitted (best-effort). */
  eventBus?: EventBus;
}

function auditPrincipalOf(principal: AuthUser): AuditPrincipal {
  // Services bypass the registry entirely; the resolver gate below also refuses
  // them, but we guard here so the audit row never records a "service" kind.
  if (principal.type === "service") {
    throw new ProposeApplyError(
      "forbidden",
      "Service principals cannot drive AI tools.",
    );
  }
  return { kind: principal.type, id: principal.id };
}

/**
 * The required access rules the principal does NOT hold, so a `forbidden` error
 * can name the missing permission (the assistant relays it to the user). Returns
 * `[]` for the `"*"` admin escape. Never includes anything the principal has.
 */
function missingRules({
  principal,
  tool,
}: {
  principal: AuthUser;
  tool: RegisteredAiTool;
}): string[] {
  const have =
    "accessRules" in principal ? (principal.accessRules ?? []) : [];
  if (have.includes("*")) return [];
  return tool.requiredAccessRules.filter((rule) => !have.includes(rule));
}

/** A `forbidden` message that names the missing rule(s) when known. */
function forbiddenMessage({
  principal,
  tool,
}: {
  principal: AuthUser;
  tool: RegisteredAiTool;
}): string {
  const missing = missingRules({ principal, tool });
  return missing.length > 0
    ? `Forbidden: ${tool.name} (missing permission: ${missing.join(", ")})`
    : `Forbidden: ${tool.name}`;
}

function emitToolCalled({
  eventBus,
  principal,
  transport,
  tool,
  status,
}: {
  eventBus?: EventBus;
  principal: AuditPrincipal;
  transport: "chat" | "mcp" | "automation";
  tool: RegisteredAiTool;
  status: "proposed" | "applied" | "failed";
}): void {
  if (!eventBus) return;
  // Best-effort, fire-and-forget: an audit/notification failure must never
  // block or fail the tool call itself.
  void eventBus.emit(aiHooks.toolCalled, {
    principalKind: principal.kind,
    principalId: principal.id,
    transport,
    toolName: tool.name,
    effect: tool.effect,
    status,
  });
}

/**
 * The transport-agnostic two-step propose -> apply service (§8, §13.4).
 *
 * `propose` runs the mutating tool's `dryRun` (the mature validateDefinition /
 * renderConfig pattern), persists a `proposed` audit row, and returns a token.
 * `apply` parses + validates the token, re-checks authorization (rules may have
 * changed since propose), and commits via `execute` — atomic single-use.
 *
 * Read-effect tools are NOT proposable: they run directly via the transport,
 * never through this gate.
 */
export function createProposeApplyService({
  registry,
  resolver,
  store,
  eventBus,
}: ProposeApplyDeps) {
  return {
    async propose({
      principal,
      toolName,
      input,
      transport,
      conversationId,
      rpcClient,
    }: {
      principal: AuthUser;
      toolName: string;
      input: unknown;
      transport: "chat" | "mcp";
      conversationId?: string;
      /** USER-scoped client (bound to the originating user) for the dry-run. */
      rpcClient: RpcClient;
    }): Promise<ProposeResult> {
      const auditPrincipal = auditPrincipalOf(principal);
      const tool = registry.getTool(toolName);
      if (!tool) {
        throw new ProposeApplyError("not_found", `Unknown tool: ${toolName}`);
      }
      // Authz gate (decision 5) — the same predicate the handler enforces.
      if (!resolver.isAllowed({ principal, tool })) {
        throw new ProposeApplyError(
          "forbidden",
          forbiddenMessage({ principal, tool }),
        );
      }
      // Only mutate/destructive tools with a dryRun are proposable.
      if (tool.effect === "read" || !tool.dryRun) {
        throw new ProposeApplyError(
          "not_proposable",
          `Tool "${toolName}" is not a proposable mutating tool.`,
        );
      }

      // Validate the input against the tool's own schema BEFORE dry-running so
      // a malformed call is rejected without side effects.
      const parsed = tool.input.safeParse(input);
      if (!parsed.success) {
        throw new ProposeApplyError(
          "execute_failed",
          `Invalid arguments for ${toolName}: ${parsed.error.message}`,
        );
      }

      const argsHash = hashToolArgs(parsed.data);
      const preview = await tool.dryRun({
        input: parsed.data,
        principal,
        rpcClient,
      });

      const { row, nonce } = await store.createProposal({
        principal: auditPrincipal,
        transport,
        conversationId,
        toolName,
        effect: tool.effect,
        argsHash,
        proposedPayload: preview.payload as Record<string, unknown>,
        resultSnapshot: { summary: preview.summary },
      });

      emitToolCalled({
        eventBus,
        principal: auditPrincipal,
        transport,
        tool,
        status: "proposed",
      });

      return {
        token: formatProposalToken({ rowId: row.id, nonce }),
        summary: preview.summary,
        payload: preview.payload,
        diff: preview.diff,
        toolCallId: row.id,
        expiresAt: row.proposalExpiresAt ?? new Date(),
      };
    },

    /**
     * Resolve a proposal token to a read-only description WITHOUT consuming it.
     * Returns undefined for a malformed token, an unknown row, or a nonce
     * mismatch (so a forged token leaks nothing). Does NOT check TTL/status -
     * the caller inspects `status` itself (an applied proposal is expected here).
     */
    async describeProposal({
      token,
    }: {
      token: string;
    }): Promise<ProposalDescription | undefined> {
      const parsedToken = parseProposalToken(token);
      if (!parsedToken) return undefined;
      const row = await store.getProposal(parsedToken.rowId);
      if (!row || !row.proposalNonce) return undefined;
      if (
        !nonceMatches({
          candidate: parsedToken.nonce,
          stored: row.proposalNonce,
        })
      ) {
        return undefined;
      }
      const snapshot = row.resultSnapshot as { summary?: unknown } | null;
      const summary =
        snapshot && typeof snapshot.summary === "string"
          ? snapshot.summary
          : undefined;
      return {
        rowId: row.id,
        toolName: row.toolName,
        status: row.status,
        conversationId: row.conversationId ?? undefined,
        summary,
      };
    },

    async apply({
      principal,
      token,
      rpcClient,
    }: {
      principal: AuthUser;
      token: string;
      transport?: "chat" | "mcp";
      /** USER-scoped client (bound to the originating user) for the commit. */
      rpcClient: RpcClient;
    }): Promise<ApplyResult> {
      const auditPrincipal = auditPrincipalOf(principal);

      const parsedToken = parseProposalToken(token);
      if (!parsedToken) {
        throw new ProposeApplyError("invalid_token", "Malformed proposal token.");
      }

      // Fetch first to validate the nonce + status + TTL with precise errors
      // (the atomic consume below is the single-use authority, but we want a
      // constant-time nonce compare and clear 410/409 distinctions).
      const existing = await store.getProposal(parsedToken.rowId);
      if (!existing || !existing.proposalNonce) {
        throw new ProposeApplyError("not_found", "Unknown proposal token.");
      }
      if (
        !nonceMatches({
          candidate: parsedToken.nonce,
          stored: existing.proposalNonce,
        })
      ) {
        // Constant-time mismatch — treat as invalid, never reveal which part.
        throw new ProposeApplyError("invalid_token", "Invalid proposal token.");
      }
      if (existing.status !== "proposed") {
        // Already applied / rejected / expired — single-use.
        throw new ProposeApplyError(
          existing.status === "expired" ? "expired" : "consumed",
          `Proposal is no longer applicable (status: ${existing.status}).`,
        );
      }
      if (
        existing.proposalExpiresAt &&
        existing.proposalExpiresAt.getTime() <= Date.now()
      ) {
        throw new ProposeApplyError("expired", "Proposal token has expired.");
      }

      const tool = registry.getTool(existing.toolName);
      if (!tool) {
        throw new ProposeApplyError(
          "not_found",
          `Tool "${existing.toolName}" is no longer registered.`,
        );
      }
      // Re-check authz at apply time — the principal's rules may have changed
      // since propose (narrowing runs live, §6.3).
      if (!resolver.isAllowed({ principal, tool })) {
        throw new ProposeApplyError(
          "forbidden",
          forbiddenMessage({ principal, tool }),
        );
      }

      // Atomic single-use consume: only one caller wins the proposed -> applied
      // transition. A concurrent second apply gets `undefined`. The applier
      // principal is stamped into the row so the audit records WHO applied,
      // even if it differs from the proposer (P3 review item 1).
      const consumed = await store.consumeProposal({
        rowId: parsedToken.rowId,
        applier: auditPrincipal,
      });
      if (!consumed) {
        throw new ProposeApplyError(
          "consumed",
          "Proposal token was already consumed.",
        );
      }

      // Belt-and-suspenders (P3 review item 2): re-parse the SERVER-STORED
      // payload against the tool's own input schema before executing. `apply`
      // executes ONLY the server-stored payload captured at propose time — never
      // any caller-supplied arguments — so this guards against a payload that no
      // longer satisfies the (possibly evolved) schema.
      const repared = tool.input.safeParse(consumed.proposedPayload);
      if (!repared.success) {
        emitToolCalled({
          eventBus,
          principal: auditPrincipal,
          transport: consumed.transport,
          tool,
          status: "failed",
        });
        throw new ProposeApplyError(
          "execute_failed",
          `Stored proposal payload for ${tool.name} no longer matches its input schema: ${repared.error.message}`,
        );
      }

      try {
        const result = await tool.execute({
          input: repared.data,
          principal,
          rpcClient,
        });
        emitToolCalled({
          eventBus,
          principal: auditPrincipal,
          transport: consumed.transport,
          tool,
          status: "applied",
        });
        return { toolCallId: consumed.id, result };
      } catch (error) {
        emitToolCalled({
          eventBus,
          principal: auditPrincipal,
          transport: consumed.transport,
          tool,
          status: "failed",
        });
        throw new ProposeApplyError(
          "execute_failed",
          extractErrorMessage(error, "Apply failed during execute."),
        );
      }
    },
  };
}

export type ProposeApplyService = ReturnType<typeof createProposeApplyService>;
