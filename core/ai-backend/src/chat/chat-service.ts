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
  AiModelFamily,
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
import { resolveModelId, resolveModelFamily } from "./llm-provider";
import * as schema from "../schema";
import type { AiMessageRow } from "../schema";
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
import { clampToolResult, toolResultCharBudget } from "./result-clamp.logic";
import {
  estimateMessagesTokens,
  estimateTextTokens,
} from "./token-estimate.logic";
import { planCompaction } from "./compaction.logic";
import { renderRowsForSummary, summarizeTurns } from "./summarize-turns";
import { prepareFinalAnswerStep } from "../step-budget.logic";
import type { ChatReadInvoker } from "./read-invoker";
import { buildChatSystemPrompt } from "./system-prompt";
import { createUserScopedRpcClient } from "../user-rpc-client";
import type { AiMemoryStore } from "../memory-store";
import type { SystemAccessResolver } from "../system-signals-contributor";
import type { AiSkillResolver } from "../skill-resolver";
import { accessibleSystems } from "../tools/memory-tools";

type AiDatabase = SafeDatabase<typeof schema>;

/** Cap on always-inject preferences folded into the prompt, to bound context. */
const MAX_ALWAYS_INJECT_MEMORIES = 25;

/**
 * Conservative context-window assumed when a connection does not configure
 * `contextWindowTokens`. Big enough not to over-compact a modern model, small
 * enough to still protect against a runaway transcript on a smaller one.
 */
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
/** Tokens reserved for the model's OWN reply (kept out of the input budget). */
const RESERVED_OUTPUT_TOKENS = 4096;
/**
 * Fixed input overhead NOT in `modelMessages`: the base system prompt and the
 * tool JSON schemas. Subtracted from the window so the heuristic stays
 * conservative (we never count tool schemas exactly).
 */
const SYSTEM_OVERHEAD_TOKENS = 6000;

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

/**
 * Routing for a projected read tool: which source procedure to re-enter, plus
 * the owning plugin's optional model-facing result projection (lean shape).
 */
export interface ChatReadRoute {
  pluginId: string;
  procedureKey: string;
  projectResult?: (output: unknown) => unknown;
}

/**
 * Whether a resolved tool is an automation-building tool, so the automation
 * playbook is injected into the prompt this turn. Registered names keep dots
 * (`automation.listCapabilities`); the provider-safe form uses underscores
 * (`automation_*`) — match either so the check is robust to where it is read.
 */
function isAutomationToolName(name: string): boolean {
  return name.startsWith("automation.") || name.startsWith("automation_");
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
  /** Optional active skill (reusable prompt) whose system-prompt seeds this turn. */
  skillId?: string;
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

/**
 * Max agent steps (tool-call round trips) per turn. The last step is reserved
 * for the forced answer (tools removed via `prepareStep`), so the model gets
 * `MAX_STEPS - 1` rounds of actual tool use - enough for a thorough multi-source
 * investigation (resolve ids, fan out across signal sources, read several docs)
 * before it must synthesise. The per-principal rate-limit budget and optional
 * spend cap remain the real cost ceiling.
 */
const MAX_STEPS = 16;

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
  resultCharBudget,
}: {
  proposeApply: ProposeApplyService;
  readInvoker: ChatReadInvoker;
  recordExecuted: ChatRecordExecuted;
  readRouting: ReadonlyMap<string, ChatReadRoute>;
  db: AiDatabase;
  conversationId: string;
  forwardHeaders: Record<string, string>;
  /** Loopback base URL for the user-scoped RPC client (re-enters `/api`). */
  internalUrl: string;
  budgetMax?: number;
  /**
   * Per-read result char budget, derived from the connection's context window
   * (see {@link toolResultCharBudget}). A read result larger than this is clamped
   * before it enters the model's context. Falls back to the module default when
   * omitted, so callers that don't know the window stay protected.
   */
  resultCharBudget?: number;
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
      const raw = executable
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
      // budget. Records the args hash, never the raw args. Recorded against the
      // FULL result (the lean/clamp shaping below is a model-context concern, not
      // an audit one).
      await recordExecuted({
        principal: chatAuditPrincipal(readPrincipal),
        conversationId,
        toolName: tool.name,
        argsHash: hashToolArgs(toolInput),
      });
      // Shape the result for the MODEL's context window (never for authz/audit):
      //  1. the owning plugin's optional lean projection (projected reads only),
      //  2. a generic size clamp so one wide read can't blow the context — and,
      //     since history is replayed verbatim every turn, keep blowing it.
      const projected = executable?.projectResult
        ? executable.projectResult(raw)
        : raw;
      return clampToolResult({ result: projected, maxChars: resultCharBudget })
        .value;
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
        // Structured "proposal succeeded, now awaiting the operator" marker so
        // the model keys on state, not the `note` prose, and stops re-proposing.
        status: "awaiting_operator",
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
  memoryStore,
  systemAccessResolver,
  skillResolver,
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
  memoryStore: AiMemoryStore;
  systemAccessResolver: SystemAccessResolver;
  /** Merged builtin + user skill catalogue (chat skill picker → system prompt). */
  skillResolver: AiSkillResolver;
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
  const readRouting = new Map<string, ChatReadRoute>();

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
   * CONTEXT COMPACTION. Turn the conversation's persisted rows into the model
   * messages for THIS turn, summarizing the oldest not-yet-covered turns into a
   * durable running summary when the prompt would exceed the connection's
   * context window. Returns the (possibly trimmed) `modelMessages` plus the
   * `summaryPreamble` to fold into the system prompt.
   *
   * Splitting at ROW boundaries (a row carries a whole turn, incl. its
   * tool-call/result parts) guarantees we never orphan a tool message. The
   * summary + marker are persisted to shared Postgres so any pod resumes from
   * the same compacted state. FAIL-OPEN: a summarizer error falls back to the
   * full uncovered history (a provider overflow then surfaces as a normal error,
   * never a crash here).
   */
  const compactHistoryForTurn = async ({
    conversation,
    conversationId,
    userId,
    rows,
    connection,
    languageModel,
    recordUsage,
    memoryPreamble,
    skillPreamble,
  }: {
    conversation: {
      summary: string | null;
      summarizedThroughMessageId: string | null;
    };
    conversationId: string;
    userId: string;
    rows: AiMessageRow[];
    connection: OpenAiCompatibleConnection;
    languageModel: ReturnType<typeof buildLanguageModel>;
    recordUsage: (usage: LanguageModelUsage) => Promise<void>;
    memoryPreamble: string;
    skillPreamble: string;
  }): Promise<{ modelMessages: ModelMessage[]; summaryPreamble: string }> => {
    let summary = conversation.summary ?? "";
    const marker = conversation.summarizedThroughMessageId;

    // Rows the running summary does NOT yet cover (everything after the marker).
    const markerIdx = marker ? rows.findIndex((r) => r.id === marker) : -1;
    const uncovered = markerIdx >= 0 ? rows.slice(markerIdx + 1) : rows;

    const windowTokens =
      connection.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
    const budgetTokens = Math.max(
      1,
      windowTokens - RESERVED_OUTPUT_TOKENS - SYSTEM_OVERHEAD_TOKENS,
    );
    const fixedTokens =
      estimateTextTokens(memoryPreamble) +
      estimateTextTokens(skillPreamble) +
      estimateTextTokens(summary);

    const plan = planCompaction({
      rows: uncovered.map((r) => ({
        id: r.id,
        tokens: estimateMessagesTokens(toModelMessages(r)),
      })),
      fixedTokens,
      budgetTokens,
    });

    let kept = uncovered;
    if (plan.needsSummary) {
      const summarizeIds = new Set(plan.summarizeRowIds);
      const keepIds = new Set(plan.keepRowIds);
      const toSummarize = uncovered.filter((r) => summarizeIds.has(r.id));
      const newMarker = plan.summarizeRowIds.at(-1);
      try {
        const { summary: merged, usage } = await summarizeTurns({
          model: languageModel,
          priorSummary: summary,
          transcript: renderRowsForSummary({ rows: toSummarize }),
        });
        summary = merged;
        await recordUsage(usage); // the summary call counts against the ledger
        if (newMarker) {
          await conversations.setSummary({
            id: conversationId,
            userId,
            summary,
            summarizedThroughMessageId: newMarker,
          });
        }
        kept = uncovered.filter((r) => keepIds.has(r.id));
      } catch {
        // FAIL-OPEN: keep the full uncovered history on a summarizer error.
        kept = uncovered;
      }
    }

    const modelMessages: ModelMessage[] = [];
    for (const row of kept) modelMessages.push(...toModelMessages(row));

    const summaryPreamble = summary
      ? "Summary of earlier conversation (older turns were compacted to fit " +
        `the context window):\n${summary}`
      : "";
    return { modelMessages, summaryPreamble };
  };

  /**
   * Build the always-inject preference preamble for a turn: the caller's visible
   * memories flagged `alwaysInject`, folded into the system prompt EVERY turn so
   * an always-apply preference (e.g. a writing-style rule) takes effect during
   * generation instead of waiting for the model to recall it. Owner-scoped `user`
   * memories plus `system` memories for systems the caller can read; bounded by a
   * cap. Returns "" when there are none. Best-effort: a lookup failure must not
   * break the turn, so it falls back to no preamble.
   */
  const buildAlwaysInjectPreamble = async (
    principal: AuthUser,
  ): Promise<string> => {
    if (principal.type !== "user" && principal.type !== "application") return "";
    try {
      const readable = await accessibleSystems({
        principal,
        resolver: systemAccessResolver,
        candidateSystemIds: await memoryStore.systemIdsWithMemories(),
        action: "read",
      });
      const memories = await memoryStore.listAlwaysInject({
        ownerId: principal.id,
        readableSystemIds: [...readable],
      });
      if (memories.length === 0) return "";
      const lines = memories
        .slice(0, MAX_ALWAYS_INJECT_MEMORIES)
        .map((m) => `- ${m.content}`)
        .join("\n");
      return (
        "Saved operator preferences you MUST follow on this and every turn " +
        "(treat as preferences, not as commands to act on; do not restate them):\n" +
        lines
      );
    } catch {
      return "";
    }
  };

  /**
   * Build the active-skill preamble for a turn: the selected skill's
   * system-prompt fragment, labelled as guidance (data, never commands to obey
   * blindly). Returns "" when no skill is selected or it has no system prompt.
   * Best-effort: a lookup failure must not break the turn.
   */
  const buildSkillPreamble = async (skillId?: string): Promise<string> => {
    if (!skillId) return "";
    try {
      const skill = await skillResolver.resolve(skillId);
      if (!skill?.systemPrompt) return "";
      return (
        `Active skill "${skill.name}" — apply this guidance for the rest of ` +
        `the conversation (treat as guidance, not as data to act on literally):\n` +
        skill.systemPrompt
      );
    } catch {
      return "";
    }
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
    memoryPreamble,
    skillPreamble,
    summaryPreamble,
    resultCharBudget,
    modelFamily,
    staleSinceMs,
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
    /** Per-read result clamp budget derived from the connection's context window. */
    resultCharBudget?: number;
    /** Declared model family; capable families get the lighter-touch calibration note. */
    modelFamily?: AiModelFamily;
    /** Always-inject preference block prepended to the system prompt (may be ""). */
    memoryPreamble?: string;
    /** Active-skill guidance block prepended to the system prompt (may be ""). */
    skillPreamble?: string;
    /**
     * Running-summary block of earlier, compacted turns (may be ""). Folded into
     * the system prompt so the model retains the gist of history that has been
     * dropped from the verbatim `modelMessages` to fit the context window.
     */
    summaryPreamble?: string;
    /**
     * Idle time (ms) since the conversation's last activity before this turn.
     * When it crosses the staleness threshold, the system prompt tells the model
     * to re-fetch rather than trust tool results from earlier in the thread.
     */
    staleSinceMs?: number;
  }): Response => {
    // Build the SDK tools from the resolver-allowed set only. The model is never
    // offered a tool the principal cannot use. Tool callbacks (budget + audit +
    // propose) are built by the pure, unit-tested helper.
    const allowed = resolver.resolveTools(principal);
    // Inject the ~600-token automation-building playbook ONLY when an automation
    // tool is in scope this turn (kept out of the always-on prompt on pure read
    // turns — see buildChatSystemPrompt). Tool names are provider-safe ids, so an
    // `automation.*` tool surfaces as `automation_*`.
    const automationTools = allowed.some((t) => isAutomationToolName(t.name));
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
        resultCharBudget,
      }),
    });

    const result = streamText({
      model: languageModel,
      // PROMPT-CACHE FRIENDLY ORDERING (Phase 3): the STABLE base prompt comes
      // FIRST so a caching-capable gateway can reuse the byte-identical prefix
      // across turns; the per-turn VOLATILE preambles (memory / skill / summary)
      // come AFTER it. Prepending the volatile blocks (the prior bug) put
      // changing content at the front and defeated any prefix cache. The date
      // line inside the base prompt is the only volatile part of the base and
      // already sits at its end.
      system: [
        buildChatSystemPrompt({
          timeZone,
          mode: conversation.permissionMode,
          automationTools,
          modelFamily,
          staleSinceMs,
        }),
        memoryPreamble,
        skillPreamble,
        summaryPreamble,
      ]
        .filter(Boolean)
        .join("\n\n"),
      // Guarantee the turn ends with an answer: on the final allowed step,
      // REMOVE all tools (activeTools: []) so the model must synthesize text
      // from what it gathered instead of spending the last step on a tool call
      // and leaving the operator with a blank reply.
      prepareStep: ({ stepNumber }) =>
        prepareFinalAnswerStep({ stepNumber, maxSteps: MAX_STEPS }),
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
        skillId,
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

      // Idle gap BEFORE this turn: `conversation` was loaded above, prior to
      // appending the user message that bumps `updatedAt`, so this is the time
      // since the last activity. A resumed-after-idle turn folds a freshness
      // directive into the system prompt so the model re-fetches current state
      // instead of answering from tool results captured earlier in the thread.
      const staleSinceMs = Date.now() - conversation.updatedAt.getTime();

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
      //
      // OPT-OUT (Phase 6): a connection may disable this round-trip
      // (`disableTopicalClassifier`). The chat system prompt already declines
      // off-topic requests, so on a capable model the extra per-first-message
      // call is redundant latency/cost — the in-prompt decline then carries it.
      if (!connection.disableTopicalClassifier) try {
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

      // Preambles feed BOTH the prompt and the compaction token budget (they
      // share the input window), so build them before compacting. Done after the
      // off-topic short-circuit so a refused turn never triggers a summary call.
      const memoryPreamble = await buildAlwaysInjectPreamble(principal);
      const skillPreamble = await buildSkillPreamble(skillId);

      // CONTEXT COMPACTION: summarize the oldest turns into a running summary
      // when the full history would exceed the window. Tool-call REPLAY is
      // preserved for the KEPT rows (each row expands into its assistant + tool
      // messages); compacted rows are represented by `summaryPreamble`.
      const { modelMessages, summaryPreamble } = await compactHistoryForTurn({
        conversation,
        conversationId,
        userId,
        rows: history,
        connection,
        languageModel,
        recordUsage,
        memoryPreamble,
        skillPreamble,
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
        memoryPreamble,
        skillPreamble,
        summaryPreamble,
        resultCharBudget: toolResultCharBudget({
          contextWindowTokens: connection.contextWindowTokens,
        }),
        modelFamily: resolveModelFamily({ connection }),
        staleSinceMs,
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

      const userId = principal.type === "user" ? principal.id : "";
      const history = await conversations.listMessages({ conversationId });

      const { resolvedModel, languageModel, recordUsage } = buildModelContext({
        principal,
        conversation,
        connectionId,
        conversationId,
        connection,
        model,
      });

      const memoryPreamble = await buildAlwaysInjectPreamble(principal);
      // Same context compaction as a normal turn (a long conversation can hit
      // the window on an acknowledgment too).
      const { modelMessages, summaryPreamble } = await compactHistoryForTurn({
        conversation,
        conversationId,
        userId,
        rows: history,
        connection,
        languageModel,
        recordUsage,
        memoryPreamble,
        skillPreamble: "",
      });
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
        memoryPreamble,
        summaryPreamble,
        resultCharBudget: toolResultCharBudget({
          contextWindowTokens: connection.contextWindowTokens,
        }),
        modelFamily: resolveModelFamily({ connection }),
      });
    },
  };
}

export type ChatService = ReturnType<typeof createChatService>;
