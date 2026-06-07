import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type ModelMessage,
  type LanguageModelUsage,
} from "ai";
import type { AuthUser, SafeDatabase, Logger } from "@checkstack/backend-api";
import type {
  OpenAiCompatibleConnection,
  AiPermissionMode,
} from "@checkstack/ai-common";
import type { AiToolResolver } from "../resolver";
import type { ProposeApplyService } from "../propose-apply/service";
import { enforceToolBudget } from "../rate-limit/tool-budget";
import {
  enforceSpendCap,
  recordSpend,
  SpendCapExceededError,
} from "../rate-limit/spend-ledger";
import { hashToolArgs } from "../propose-apply/args-hash";
import { resolveModelId } from "./llm-provider";
import * as schema from "../schema";
import type { AiConversationStore } from "./conversation-store";
import { buildLanguageModel } from "./llm-provider";
import { applyAutoTitle } from "./title-service";
import {
  classifyTopic,
  type ClassifierTextGenerator,
} from "./classifier-service";
import { OFF_TOPIC_REFUSAL } from "./classifier.logic";
import { normalizeModelMessages } from "./normalize-messages.logic";
import { formatModelError } from "./model-error.logic";
import { buildDecisionNote, type DecisionKind } from "./decision.logic";
import {
  buildAgentSdkTools,
  type ConfirmCardResult,
  type AutoAppliedResult,
  type DuplicateToolCallResult,
  type ValidationFeedbackResult,
  type AgentToolCallbacks,
} from "./sdk-tools";
import { ToolValidationError } from "../propose-apply/validation-error";
import type { ChatReadInvoker } from "./read-invoker";
import { buildChatSystemPrompt } from "./system-prompt";
import { createUserScopedRpcClient } from "../user-rpc-client";

type AiDatabase = SafeDatabase<typeof schema>;

/**
 * The roles the AI SDK accepts in a `ModelMessage`. A persisted `modelMessages`
 * entry is validated against this before replay so a malformed row can never
 * crash the loop.
 */
const MODEL_MESSAGE_ROLES = new Set([
  "system",
  "user",
  "assistant",
  "tool",
]);

/**
 * Faithfully narrow a stored `modelMessages` entry (a JSON object) into an
 * AI-SDK `ModelMessage`. The shape was produced by the SDK itself (the
 * canonical `ResponseMessage`) and only scrubbed before persist, so a runtime
 * role-check is sufficient — we never hand-build parts. Returns undefined for an
 * entry that does not look like a model message (defensive against legacy /
 * corrupt rows).
 */
function asModelMessage(
  entry: Record<string, unknown>,
): ModelMessage | undefined {
  const role = entry.role;
  if (typeof role !== "string" || !MODEL_MESSAGE_ROLES.has(role)) {
    return undefined;
  }
  if (!("content" in entry)) return undefined;
  // The SDK's own ResponseMessage shape: role + content (string | parts[]).
  // It round-trips through JSON unchanged, so it is already a ModelMessage.
  return entry as unknown as ModelMessage;
}

/**
 * Reconstruct a persisted message row into AI-SDK `ModelMessage`s for replay.
 *
 * TOOL-MESSAGE REPLAY (Phase 6): when a row carries `modelMessages` (the
 * canonical AI-SDK `ResponseMessage[]` the assistant turn produced — assistant
 * tool-call parts + tool-result parts), those are replayed VERBATIM, so a
 * resumed multi-turn conversation shows the model its prior tool interactions in
 * full, not just the rendered text. Falls back to text-only for user/system rows
 * and for legacy assistant rows written before `modelMessages` existed.
 *
 * Replay is ALL-OR-NOTHING per row: if ANY entry of the row's `modelMessages`
 * array fails `asModelMessage` (DB tampering / a future bug), the whole row falls
 * back to its TEXT representation rather than replaying a partial array. Dropping
 * individual entries could keep an assistant tool-call while losing its matching
 * tool-result (or leave an orphaned tool-result), which the LLM provider rejects
 * as a malformed message sequence.
 *
 * Returns an ARRAY because one assistant turn can expand into several model
 * messages (the assistant message + one tool message per tool round-trip).
 */
export function toModelMessages(row: {
  role: string;
  content: Record<string, unknown>;
  modelMessages: Array<Record<string, unknown>> | null;
}): ModelMessage[] {
  // Prefer the canonical SDK messages (full tool-call history replay).
  if (row.modelMessages && row.modelMessages.length > 0) {
    const replayed: ModelMessage[] = [];
    let allValid = true;
    for (const entry of row.modelMessages) {
      const m = asModelMessage(entry);
      if (!m) {
        // A single malformed entry invalidates the whole row's replay — never
        // emit a partial (and possibly orphaned tool-call/result) sequence.
        allValid = false;
        break;
      }
      replayed.push(m);
    }
    if (allValid && replayed.length > 0) return replayed;
    // Fall through to text on a partially- or fully-malformed array.
  }

  // Text-only fallback (user/system rows, legacy assistant rows).
  const text = typeof row.content.text === "string" ? row.content.text : "";
  if (row.role === "user") return [{ role: "user", content: text }];
  if (row.role === "assistant") return [{ role: "assistant", content: text }];
  if (row.role === "system") return [{ role: "system", content: text }];
  // A standalone tool row with no modelMessages cannot be safely replayed as
  // text (a dangling tool result would break the SDK message ordering); skip it.
  return [];
}

/**
 * Normalize the AI-SDK `LanguageModelUsage` (token fields are `number |
 * undefined`) into the spend ledger's input/output token counts. A provider
 * that omits a count contributes 0 — the cap never crashes on missing usage.
 */
function usageTokens(usage: LanguageModelUsage): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
}

/** Per-turn dedupe key for a mutating tool call: `<tool>:<argsHash>`. */
function turnKey({
  tool,
  input,
}: {
  tool: { name: string };
  input: unknown;
}): string {
  return `${tool.name}:${hashToolArgs(input)}`;
}

/**
 * Turn a {@link ToolValidationError} thrown by a tool's `dryRun` into a
 * model-facing tool result, so the structured issues reach the MODEL (which can
 * fix them and re-propose) instead of leaking to the operator as a raw stream
 * error with the proposal lost. The turn-dedup key is deliberately NOT recorded
 * for this case, so the corrected retry is allowed.
 */
function toValidationFeedback({
  toolName,
  error,
}: {
  toolName: string;
  error: ToolValidationError;
}): ValidationFeedbackResult {
  return {
    __validationFailed: true,
    toolName,
    issues: error.issues,
    note:
      "Your drafted input did not validate. Fix EVERY issue listed above, then " +
      "call this tool again with the corrected input. Do NOT tell the operator " +
      "the change is done - nothing has been proposed or applied yet. If an " +
      "issue is unclear or you are missing a value, ask the operator instead of " +
      "guessing.",
  };
}

/** Audit-key a chat principal (chat is RealUser-only; services are refused). */
function chatAuditPrincipal(
  principal: AuthUser,
): { kind: "user" | "application"; id: string } {
  if (principal.type === "service") {
    throw new Error("Service principals cannot use AI chat.");
  }
  return { kind: principal.type, id: principal.id };
}

/** Loads decrypted connection credentials for the chat provider (backend-only). */
export interface ChatConnectionResolver {
  /** Resolve a connection's full credentials by qualified connection id. */
  resolve(args: {
    connectionId: string;
  }): Promise<OpenAiCompatibleConnection | undefined>;
}

/**
 * Audit-records a directly-executed chat read tool into `ai_tool_calls` with
 * `transport: "chat"`. Without this, chat reads would be absent from the audit
 * log AND would not count toward the per-principal rate-limit budget (a rolling
 * COUNT over `ai_tool_calls`), letting a read-heavy chat session bypass the
 * budget the phase enforces on BOTH transports.
 */
export type ChatRecordExecuted = (args: {
  principal: { kind: "user" | "application"; id: string };
  conversationId: string;
  toolName: string;
  argsHash: string;
}) => Promise<void>;

/** A single chat turn's input. */
export interface ChatTurnInput {
  principal: AuthUser;
  conversationId: string;
  connectionId: string;
  /** Conversation-selected model id (validated against the connection). */
  model?: string;
  /** The incoming chat request's auth headers (forwarded to read tools). */
  forwardHeaders: Record<string, string>;
  /** The user's new message text. */
  userText: string;
  /** The operator's IANA timezone (browser-detected) for resolving bare times. */
  timeZone?: string;
}

/**
 * A post-confirm-card decision turn's input. The actual apply runs separately
 * through `applyTool` (unchanged); this turn only makes the model react to the
 * operator's apply/decline so the conversation does not dead-end on "waiting for
 * your confirmation".
 */
export interface ChatDecisionInput {
  principal: AuthUser;
  conversationId: string;
  connectionId: string;
  /** Conversation-selected model id (validated against the connection). */
  model?: string;
  /** The incoming request's auth headers (forwarded to read tools). */
  forwardHeaders: Record<string, string>;
  /** The proposal token from the confirm card. */
  token: string;
  /** Whether the operator applied or declined the card. */
  decision: DecisionKind;
  /** The operator's IANA timezone (browser-detected) for resolving bare times. */
  timeZone?: string;
}

/** Max agent steps (tool-call round trips) per turn. */
const MAX_STEPS = 8;

/**
 * Build the agent-loop tool callbacks for a single chat turn. Extracted so the
 * audit + budget + propose wiring is unit-testable WITHOUT a live model/stream:
 *
 *  - `enforceBudget` runs the shared-Postgres per-principal budget BEFORE a tool.
 *  - `runRead` re-enters the live router as the logged-in user (handler authz),
 *    then audit-records the executed read with `transport: "chat"` so it lands
 *    in the audit log AND counts toward the budget (a rolling COUNT over
 *    `ai_tool_calls`).
 *  - mutate/destructive tools go through `propose` and return a confirm card.
 */
export function buildChatToolCallbacks({
  proposeApply,
  readInvoker,
  recordExecuted,
  readRouting,
  db,
  conversationId,
  forwardHeaders,
  internalUrl,
  budgetMax,
}: {
  proposeApply: ProposeApplyService;
  readInvoker: ChatReadInvoker;
  recordExecuted: ChatRecordExecuted;
  readRouting: ReadonlyMap<string, { pluginId: string; procedureKey: string }>;
  db: AiDatabase;
  conversationId: string;
  forwardHeaders: Record<string, string>;
  /** Loopback base URL for the user-scoped RPC client (re-enters `/api`). */
  internalUrl: string;
  budgetMax?: number;
}): AgentToolCallbacks {
  // USER-SCOPED RPC client for this turn, bound to the originating user's auth
  // (cookie / bearer in `forwardHeaders`). Every tool `execute`/`dryRun` gets it
  // so plugin calls re-authenticate as the user and run full handler authz
  // (access rules + per-resource/team scope) - NEVER the trusted service client.
  const rpcClient = createUserScopedRpcClient({ internalUrl, forwardHeaders });

  // Per-TURN guard against the model firing the same mutating tool with the same
  // arguments repeatedly (observed: three identical `healthcheck.update`
  // proposals in a row because the model thought the first did not land). Keyed
  // by `<tool>:<argsHash>`; a repeat returns a DuplicateToolCallResult so no
  // second card/token is created and the model gets a clear "already handled".
  const handledThisTurn = new Set<string>();

  return {
    enforceBudget: async (p) => {
      await enforceToolBudget({
        db,
        principal: chatAuditPrincipal(p),
        max: budgetMax,
      });
    },
    runRead: async ({ principal: readPrincipal, tool, input: toolInput }) => {
      // Two kinds of read tool reach here:
      //  1. PROJECTED read tools (one source oRPC procedure) carry routing and
      //     re-enter the live router as the logged-in user (handler authz).
      //  2. COMPOSITE read tools (e.g. `ai.searchDocs` / `ai.getDoc`,
      //     `ai.getScriptContext` / `ai.testScript`) have no single source
      //     procedure to route to, so they run their own `execute` directly.
      //     The resolver gate (`requiredAccessRules`) gates the surface; a
      //     composite tool that fans out via the trusted service client MUST
      //     re-check the principal's per-context access in its own `execute`
      //     (the service client is trusted and skips principal checks).
      const executable = readRouting.get(tool.name);
      const result = executable
        ? await readInvoker.invoke({
            pluginId: executable.pluginId,
            procedureKey: executable.procedureKey,
            input: toolInput,
            forwardHeaders,
          })
        : await tool.execute({
            input: toolInput,
            principal: readPrincipal,
            rpcClient,
          });
      // Audit-record the executed read (transport "chat"): keeps chat reads in
      // the audit log AND makes them count toward the per-principal rate-limit
      // budget. Records the args hash, never the raw args.
      await recordExecuted({
        principal: chatAuditPrincipal(readPrincipal),
        conversationId,
        toolName: tool.name,
        argsHash: hashToolArgs(toolInput),
      });
      return result;
    },
    propose: async ({ principal: proposePrincipal, tool, input: toolInput }) => {
      const key = turnKey({ tool, input: toolInput });
      if (handledThisTurn.has(key)) {
        const duplicate: DuplicateToolCallResult = {
          __duplicate: true,
          toolName: tool.name,
          note:
            "You already proposed this exact change in this turn; a confirmation " +
            "card is shown to the operator and is awaiting their decision. Do NOT " +
            "propose it again - tell the operator you are waiting for them to " +
            "approve or decline.",
        };
        return duplicate;
      }
      let proposal;
      try {
        proposal = await proposeApply.propose({
          principal: proposePrincipal,
          toolName: tool.name,
          input: toolInput,
          transport: "chat",
          conversationId,
          rpcClient,
        });
      } catch (error) {
        // Semantic validation failure: feed the issues back to the model to
        // self-correct rather than surfacing a raw error to the operator. The
        // turn-key is NOT recorded, so the corrected retry is allowed.
        if (error instanceof ToolValidationError) {
          return toValidationFeedback({ toolName: tool.name, error });
        }
        throw error;
      }
      handledThisTurn.add(key);
      const card: ConfirmCardResult = {
        __confirm: true,
        toolName: tool.name,
        effect: tool.effect === "destructive" ? "destructive" : "mutate",
        summary: proposal.summary,
        token: proposal.token,
        payload: proposal.payload,
        diff: proposal.diff,
        expiresAt: proposal.expiresAt.toISOString(),
        note:
          "A confirmation card for this change has been shown to the operator. " +
          "STOP here: do NOT call this tool again and do NOT say the change is " +
          "applied yet. Briefly tell the operator you have proposed the change " +
          "and are waiting for them to approve or decline.",
      };
      return card;
    },
    // AUTO-mode-only server-side auto-apply for `mutate` tools. It runs the
    // EXACT SAME two-step propose -> apply through the propose/apply service the
    // human path uses: `propose` persists a `proposed` audit row + re-checks
    // `isAllowed`; `apply` re-checks `isAllowed` AGAIN, atomically consumes the
    // single-use token, and writes the `applied` audit row. There is NO weaker
    // path - the only difference from the human flow is that the apply token is
    // consumed immediately in-process instead of after a human click. The agent
    // loop only ever reaches this for `mutate` tools (destructive tools are
    // routed to `propose` by `decideToolDisposition`), so a destructive tool can
    // never reach this auto-apply path.
    autoApply: async ({ principal: applyPrincipal, tool, input: toolInput }) => {
      const key = turnKey({ tool, input: toolInput });
      if (handledThisTurn.has(key)) {
        const duplicate: DuplicateToolCallResult = {
          __duplicate: true,
          toolName: tool.name,
          note:
            "You already applied this exact change in this turn. Do NOT apply it " +
            "again - just confirm to the operator what changed.",
        };
        return duplicate;
      }
      let proposal;
      try {
        proposal = await proposeApply.propose({
          principal: applyPrincipal,
          toolName: tool.name,
          input: toolInput,
          transport: "chat",
          conversationId,
          rpcClient,
        });
      } catch (error) {
        // Same self-correction loop as the propose path: a validation failure
        // becomes model-facing feedback, never a silent auto-apply of a broken
        // draft or a raw error to the operator.
        if (error instanceof ToolValidationError) {
          return toValidationFeedback({ toolName: tool.name, error });
        }
        throw error;
      }
      const applied = await proposeApply.apply({
        principal: applyPrincipal,
        token: proposal.token,
        transport: "chat",
        rpcClient,
      });
      handledThisTurn.add(key);
      const result: AutoAppliedResult = {
        __applied: true,
        toolName: tool.name,
        effect: "mutate",
        summary: proposal.summary,
        toolCallId: applied.toolCallId,
        result: applied.result,
        diff: proposal.diff,
        note:
          "This change was applied. Do NOT call this tool again for the same " +
          "change; briefly confirm to the operator what changed.",
      };
      return result;
    },
  };
}

/**
 * The server-side agent loop (Phase 4). Provider-agnostic (base-URL override),
 * credentials stay on the backend, tools come from the SAME registry/resolver
 * as MCP, read tools auto-run, mutating/destructive tools surface a confirm
 * card. Conversation history is loaded from shared Postgres so the loop is
 * resumable on any pod.
 */
export function createChatService({
  resolver,
  proposeApply,
  conversations,
  connections,
  readInvoker,
  recordExecuted,
  db,
  logger,
  internalUrl,
  budgetMax,
  classifierGenerate,
}: {
  resolver: AiToolResolver;
  proposeApply: ProposeApplyService;
  conversations: AiConversationStore;
  connections: ChatConnectionResolver;
  readInvoker: ChatReadInvoker;
  /** Audit-record a directly-executed chat read tool (audit + budget count). */
  recordExecuted: ChatRecordExecuted;
  db: AiDatabase;
  /** Surfaces masked provider/stream errors to the server log (see onError). */
  logger: Logger;
  /** Loopback base URL for the per-turn user-scoped RPC client (re-enters `/api`). */
  internalUrl: string;
  /** Optional per-principal tool budget override (defaults applied otherwise). */
  budgetMax?: number;
  /**
   * Override the cheap topical pre-classifier's model call (tests inject a
   * fake). Defaults to a `generateText` against the turn's resolved model.
   */
  classifierGenerate?: ClassifierTextGenerator;
}) {
  // Read-tool name -> source routing. Populated by the plugin at init (the
  // projected read tools' routing is only known then). Shared by reference with
  // the closure below and the public property on the returned object.
  const readRouting = new Map<
    string,
    { pluginId: string; procedureKey: string }
  >();

  /**
   * Resolve the per-turn model context shared by every model call in a turn:
   * the validated model id, the provider language model, and a best-effort
   * spend-ledger recorder. `recordUsage` is fail-open (a ledger write failure
   * must never crash a turn) and is used for BOTH the classifier's small usage
   * and the turn's usage.
   */
  const buildModelContext = ({
    principal,
    conversation,
    connectionId,
    conversationId,
    connection,
    model,
  }: {
    principal: AuthUser;
    conversation: { model: string | null };
    connectionId: string;
    conversationId: string;
    connection: OpenAiCompatibleConnection;
    model?: string;
  }) => {
    const resolvedModel = resolveModelId({
      connection,
      requested: model ?? conversation.model ?? undefined,
    });
    const languageModel = buildLanguageModel({ connection, model: resolvedModel });
    const recordUsage = async (usage: LanguageModelUsage): Promise<void> => {
      try {
        await recordSpend({
          db,
          integrationId: connectionId,
          principal: chatAuditPrincipal(principal),
          conversationId,
          model: resolvedModel,
          usage: usageTokens(usage),
        });
      } catch {
        // swallow — recording is best-effort, enforcement is the guarantee.
      }
    };
    return { resolvedModel, languageModel, recordUsage };
  };

  /**
   * Run the streaming agent loop over a prepared message history and return the
   * AI-SDK UI message stream `Response`. Shared by `streamTurn` (a user message)
   * and `streamDecision` (a post-confirm-card acknowledgment). Persists the
   * assistant turn on completion and surfaces the real provider error.
   */
  const streamModel = ({
    principal,
    conversation,
    conversationId,
    forwardHeaders,
    resolvedModel,
    languageModel,
    recordUsage,
    modelMessages,
    timeZone,
  }: {
    principal: AuthUser;
    conversation: { permissionMode: AiPermissionMode };
    conversationId: string;
    forwardHeaders: Record<string, string>;
    resolvedModel: string;
    languageModel: ReturnType<typeof buildLanguageModel>;
    recordUsage: (usage: LanguageModelUsage) => Promise<void>;
    modelMessages: ModelMessage[];
    /** The operator's IANA timezone (from the browser), folded into the prompt. */
    timeZone?: string;
  }): Response => {
    // Build the SDK tools from the resolver-allowed set only. The model is never
    // offered a tool the principal cannot use. Tool callbacks (budget + audit +
    // propose) are built by the pure, unit-tested helper.
    const allowed = resolver.resolveTools(principal);
    const sdkTools = buildAgentSdkTools({
      tools: allowed,
      principal,
      // The conversation's durable permission mode (shared Postgres, so the SAME
      // mode is read on whichever pod handles this turn). Governs the `mutate`
      // branch only; reads always run, destructive always confirms.
      mode: conversation.permissionMode,
      callbacks: buildChatToolCallbacks({
        proposeApply,
        readInvoker,
        recordExecuted,
        readRouting,
        db,
        conversationId,
        forwardHeaders,
        internalUrl,
        budgetMax,
      }),
    });

    const result = streamText({
      model: languageModel,
      system: buildChatSystemPrompt({
        timeZone,
        mode: conversation.permissionMode,
      }),
      // Defensively normalize: drop empty-content rows and merge consecutive
      // same-role messages so a failed prior turn (which persists no assistant
      // reply, leaving consecutive `user` rows) cannot poison the history into a
      // permanent provider 400 (`invalid_prompt`) on strict providers.
      messages: normalizeModelMessages(modelMessages),
      tools: sdkTools,
      stopWhen: stepCountIs(MAX_STEPS),
      onFinish: async ({ text, steps, totalUsage }) => {
        // Collect the canonical AI-SDK ResponseMessage[] across EVERY step
        // (assistant tool-call parts + tool-result parts) so a resumed
        // conversation replays the full tool-call history, not just text.
        // Scrubbing happens on the write path (appendMessage).
        const replayMessages: Array<Record<string, unknown>> = [];
        for (const step of steps) {
          for (const m of step.response.messages) {
            replayMessages.push(m as unknown as Record<string, unknown>);
          }
        }
        // Persist the assistant turn. Secrets never appear here: the model only
        // ever sees tool RESULTS (which the source procedures already redact)
        // and never the integration credential — and the write path scrubs any
        // credential-shaped key/value regardless.
        try {
          await conversations.appendMessage({
            conversationId,
            role: "assistant",
            content: { text },
            modelMessages:
              replayMessages.length > 0 ? replayMessages : undefined,
          });
        } catch {
          // Best-effort persistence; a write failure must not crash the stream.
        }
        // Record the turn's token usage into the shared spend ledger so the
        // per-integration cap is counted cross-pod (best-effort; see
        // recordUsage). Fail-open on recording, never on enforcement.
        await recordUsage(totalUsage);
      },
    });

    // Surface the REAL provider/stream error instead of the AI SDK's masked
    // generic "An error occurred". The provider's HTTP body (e.g. a 400
    // `invalid_prompt`) is logged server-side AND returned to the UI so an
    // operator can see and forward it. No credential is in the error body.
    return result.toUIMessageStreamResponse({
      onError: (error) => {
        const { userMessage, logDetail } = formatModelError({ error });
        logger.error("AI chat model call failed", {
          ...logDetail,
          conversationId,
          model: resolvedModel,
        });
        return userMessage;
      },
    });
  };

  /** Load the conversation and assert it belongs to the principal (or 404). */
  const loadOwnedConversation = async ({
    principal,
    conversationId,
  }: {
    principal: AuthUser;
    conversationId: string;
  }) => {
    const userId = principal.type === "user" ? principal.id : "";
    return conversations.getConversation({ id: conversationId, userId });
  };

  /** Enforce the per-integration spend cap up front (or a 429 Response). */
  const enforceSpendOrResponse = async ({
    principal,
    connectionId,
    connection,
  }: {
    principal: AuthUser;
    connectionId: string;
    connection: OpenAiCompatibleConnection;
  }): Promise<Response | undefined> => {
    try {
      await enforceSpendCap({
        db,
        integrationId: connectionId,
        principal: chatAuditPrincipal(principal),
        cap: connection.spendCap,
      });
      return undefined;
    } catch (error) {
      if (error instanceof SpendCapExceededError) {
        return Response.json({ error: error.message }, { status: 429 });
      }
      throw error;
    }
  };

  return {
    readRouting,

    /**
     * Stream a chat turn. Returns a `Response` whose body is the AI-SDK UI
     * message stream (SSE). Persists the user message up front and the
     * assistant message on completion (`onFinish`).
     */
    async streamTurn(input: ChatTurnInput): Promise<Response> {
      const {
        principal,
        conversationId,
        connectionId,
        model,
        forwardHeaders,
        userText,
        timeZone,
      } = input;

      // Ownership: the conversation MUST belong to the principal.
      const userId = principal.type === "user" ? principal.id : "";
      const conversation = await loadOwnedConversation({
        principal,
        conversationId,
      });
      if (!conversation) {
        return Response.json(
          { error: "Conversation not found." },
          { status: 404 },
        );
      }

      const connection = await connections.resolve({ connectionId });
      if (!connection) {
        return Response.json(
          { error: "AI integration connection not found." },
          { status: 400 },
        );
      }

      // PER-INTEGRATION SPEND CAP (default OFF): refuse the turn up front when
      // the principal is over the integration's configured token budget. The
      // sum is read from the shared `ai_spend` ledger, so the cap holds across
      // all pods. A no-op when the connection configures no `spendCap`.
      const capped = await enforceSpendOrResponse({
        principal,
        connectionId,
        connection,
      });
      if (capped) return capped;

      // Persist the user's message before streaming, so a mid-stream pod crash
      // still leaves a complete, resumable transcript in shared Postgres.
      await conversations.appendMessage({
        conversationId,
        role: "user",
        content: { text: userText },
      });

      const history = await conversations.listMessages({ conversationId });
      const modelMessages: ModelMessage[] = [];
      for (const row of history) {
        // Tool-call REPLAY: one row can expand into several model messages
        // (assistant + tool messages) when it carries canonical SDK messages.
        modelMessages.push(...toModelMessages(row));
      }

      const { resolvedModel, languageModel, recordUsage } = buildModelContext({
        principal,
        conversation,
        connectionId,
        conversationId,
        connection,
        model,
      });

      // TOPICAL PRE-CLASSIFIER: a cheap model call decides whether the message
      // is about operating Checkstack BEFORE the expensive tool loop runs. On
      // OFF_TOPIC we short-circuit with a canned refusal (saving the generation
      // + tool tokens). FAIL-OPEN: if the classifier throws, we proceed with the
      // normal turn — a classifier hiccup must never block legitimate use. The
      // classifier's own small usage is still recorded against the ledger.
      try {
        const { verdict, usage } = await classifyTopic({
          model: languageModel,
          userText,
          generate: classifierGenerate,
        });
        // Account the classifier's tokens like any other model call.
        await recordUsage(usage);
        if (verdict === "OFF_TOPIC") {
          // Persist the refusal as the assistant turn (best-effort), then emit
          // it over the SAME SSE stream path the normal turn uses so the
          // frontend renders it identically.
          try {
            await conversations.appendMessage({
              conversationId,
              role: "assistant",
              content: { text: OFF_TOPIC_REFUSAL },
            });
          } catch {
            // Best-effort persistence; a write failure must not block the reply.
          }
          const stream = createUIMessageStream({
            execute: ({ writer }) => {
              const id = crypto.randomUUID();
              writer.write({ type: "text-start", id });
              writer.write({
                type: "text-delta",
                id,
                delta: OFF_TOPIC_REFUSAL,
              });
              writer.write({ type: "text-end", id });
            },
          });
          return createUIMessageStreamResponse({ stream });
        }
      } catch {
        // FAIL-OPEN: classifier outage -> fall through to the normal turn.
      }

      // AUTO-TITLE (fire-and-forget): when this is the FIRST user message of a
      // still-untitled conversation, derive a concise title and persist it so
      // the sidebar stops showing "Untitled chat". Runs detached from the
      // stream — a title failure can NEVER delay or crash the streamed turn
      // (generateConversationTitle itself falls back to a heuristic on error).
      // `history` already includes the just-appended user message, so a single
      // user row means this is the conversation's first turn.
      if (!conversation.title && history.length === 1) {
        void applyAutoTitle({
          conversations,
          model: languageModel,
          conversationId,
          userId,
          firstMessage: userText,
        });
      }

      return streamModel({
        principal,
        conversation,
        conversationId,
        forwardHeaders,
        resolvedModel,
        languageModel,
        recordUsage,
        modelMessages,
        timeZone,
      });
    },

    /**
     * Stream a post-confirm-card ACKNOWLEDGMENT turn. The actual apply already
     * ran via `applyTool` (unchanged); here the model is told the operator's
     * apply/decline decision and streams a short reply so the conversation does
     * not dead-end on "waiting for your confirmation". The decision note is
     * derived SERVER-SIDE from the stored proposal (tool name + summary) and is
     * EPHEMERAL — appended to this turn's history only, never persisted. The
     * assistant's reply (persisted normally) carries the outcome forward.
     */
    async streamDecision(input: ChatDecisionInput): Promise<Response> {
      const {
        principal,
        conversationId,
        connectionId,
        model,
        forwardHeaders,
        token,
        decision,
        timeZone,
      } = input;

      const conversation = await loadOwnedConversation({
        principal,
        conversationId,
      });
      if (!conversation) {
        return Response.json(
          { error: "Conversation not found." },
          { status: 404 },
        );
      }

      const connection = await connections.resolve({ connectionId });
      if (!connection) {
        return Response.json(
          { error: "AI integration connection not found." },
          { status: 400 },
        );
      }

      // Resolve the proposal this decision refers to (read-only, no consume) and
      // verify it belongs to THIS conversation — the token alone must not let a
      // user drive an acknowledgment for another conversation's proposal.
      const proposal = await proposeApply.describeProposal({ token });
      if (!proposal || proposal.conversationId !== conversationId) {
        return Response.json(
          { error: "Unknown proposal for this conversation." },
          { status: 404 },
        );
      }
      // An apply acknowledgment must reflect reality: the human apply path
      // (`applyTool`) runs FIRST and flips the row to `applied`. If it is not
      // applied, refuse — never claim a change that did not happen. A decline
      // acknowledgment needs no particular status.
      if (decision === "apply" && proposal.status !== "applied") {
        return Response.json(
          { error: "Proposal has not been applied." },
          { status: 409 },
        );
      }

      const capped = await enforceSpendOrResponse({
        principal,
        connectionId,
        connection,
      });
      if (capped) return capped;

      const history = await conversations.listMessages({ conversationId });
      const modelMessages: ModelMessage[] = [];
      for (const row of history) {
        modelMessages.push(...toModelMessages(row));
      }
      // Ephemeral, NON-persisted note delivering the human decision to the model
      // (server-derived; no client text reaches the model). The assistant's
      // streamed reply is what gets persisted and carries the outcome forward.
      modelMessages.push({
        role: "user",
        content: buildDecisionNote({
          decision,
          toolName: proposal.toolName,
          summary: proposal.summary,
        }),
      });

      const { resolvedModel, languageModel, recordUsage } = buildModelContext({
        principal,
        conversation,
        connectionId,
        conversationId,
        connection,
        model,
      });

      return streamModel({
        principal,
        conversation,
        conversationId,
        forwardHeaders,
        resolvedModel,
        languageModel,
        recordUsage,
        modelMessages,
        timeZone,
      });
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
