import { useEffect, useMemo, useRef, useState } from "react";
import {
  PageLayout,
  Card,
  CardContent,
  Button,
  Badge,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  LoadingSpinner,
  EmptyState,
  MarkdownBlock,
  ConfirmationModal,
  Alert,
  AlertIcon,
  AlertContent,
  AlertTitle,
  AlertDescription,
  usePerformance,
  useInitOnceForKey,
  cn,
} from "@checkstack/ui";
import { usePluginClient, useQueryClient } from "@checkstack/frontend-api";
import {
  AiApi,
  pluginMetadata,
  type AiPermissionMode,
} from "@checkstack/ai-common";
import {
  Sparkles,
  Send,
  Plus,
  Trash2,
  AlertCircle,
  X,
  Copy,
  Check,
  Loader2,
  Wrench,
} from "lucide-react";
import { useChatTurn } from "../lib/use-chat-turn";
import { ConfirmCardView } from "../components/ConfirmCardView";
import { AppliedCardView } from "../components/AppliedCardView";
import { QuestionCardView } from "../components/QuestionCardView";
import { buildModelOptions } from "../lib/model-options.logic";
import { decideNewChatAction } from "../lib/new-chat.logic";
import {
  PERMISSION_MODE_OPTIONS,
  deriveModeToggleValue,
  buildModeUpdate,
} from "../lib/mode-toggle.logic";
import type { ChatMessage, AssistantPart } from "../lib/chat-state";
import { toolActivityLabel } from "../lib/tool-activity-label";

/**
 * Seed prompts for the chat empty state. They double as orientation: the first
 * group teaches Checkstack's core concepts ("Explain SLOs", "How do I add a
 * system?") so a new operator can use the assistant to learn the product, not
 * just to run tasks. The second group keeps the original task-style prompts.
 * Clicking one drops it into the composer (it is not auto-sent), so the operator
 * can edit before sending.
 */
const CHAT_EXAMPLE_PROMPTS = [
  "Explain SLOs and how they relate to health checks",
  "How do I add a system to the catalog?",
  "Summarize the open incidents",
  "Draft an automation that pages on-call when the API health check fails",
] as const;

/**
 * A single tool-call status line, rendered at the point in the turn where the
 * model invoked the tool: a running spinner, a done check, or an error. The spin
 * is disabled on low-power devices (see performance rule) - it falls back to a
 * static wrench so the line is still legible without an infinite animation.
 */
function ToolStatusLine({
  part,
  isLowPower,
}: {
  part: Extract<AssistantPart, { kind: "tool" }>;
  isLowPower: boolean;
}) {
  const isError = part.status === "error";
  // Friendly verb phrase instead of the raw tool id ("Searching documentation"
  // not "ai_searchDocs"), so the line reads as the assistant narrating its work.
  const label = toolActivityLabel(part.toolName);
  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
        isError
          ? "border-status-down/30 bg-status-down/10 text-status-down"
          : "border-border/50 bg-surface-inset text-muted-foreground",
      )}
    >
      {part.status === "running" ? (
        isLowPower ? (
          <Wrench className="h-3 w-3 shrink-0" />
        ) : (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
        )
      ) : isError ? (
        <AlertCircle className="h-3 w-3 shrink-0" />
      ) : (
        <Check className="h-3 w-3 shrink-0 text-status-ok" />
      )}
      {/* Raw tool id kept in the tooltip for operators who want it. */}
      <span className="font-medium" title={part.toolName}>
        {label}
      </span>
      {part.status === "running" ? <span>...</span> : null}
      {isError && part.errorText ? (
        <span className="min-w-0 truncate" title={part.errorText}>
          - {part.errorText}
        </span>
      ) : null}
    </div>
  );
}

/** One rendered message row: user bubble, or the assistant's ordered parts. */
function MessageRow({
  message,
  onDecision,
  onAnswer,
  busy,
}: {
  message: ChatMessage;
  onDecision: (decision: {
    token: string;
    decision: "apply" | "decline";
  }) => void;
  /** Send the operator's answer to an `askOperator` question card. */
  onAnswer: (value: string) => void;
  /** A turn is streaming, so question-card chips are disabled. */
  busy: boolean;
}) {
  const { isLowPower } = usePerformance();
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        {/* User text stays plain, preserving newlines. The mirrored top-right
            corner anchors the bubble as "from you". */}
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.06),0_4px_12px_-8px_hsl(var(--foreground)/0.18)]">
          {message.text}
        </div>
      </div>
    );
  }

  // Show a trailing "Thinking..." while the turn is still streaming and we are
  // waiting on the model's next output: before any part arrives, and in the gap
  // AFTER a tool call completes (or a card is proposed) while the model decides
  // what to do next. We do NOT show it while text is actively streaming (the
  // text itself is the progress) or while a tool is still running (its own
  // spinner shows that).
  const lastPart = message.parts.at(-1);
  const thinking =
    message.streaming &&
    (!lastPart ||
      lastPart.kind === "confirm" ||
      lastPart.kind === "applied" ||
      (lastPart.kind === "tool" && lastPart.status !== "running"));
  // A server-driven progress heartbeat: the step number climbs with each agent
  // round (an SDK `start-step`), so a slow-but-progressing turn reads as
  // "Working... (step 3)" rather than a static "Thinking...", letting an
  // operator tell live progress from a stuck turn.
  const stepCount = message.stepCount ?? 0;
  const thinkingLabel =
    stepCount > 0 ? `Working... (step ${stepCount})` : "Thinking...";

  return (
    <div className="flex justify-start gap-2">
      {/* Leading assistant glyph so assistant turns are instantly scannable in
          a long transcript. Static (no animation) - safe on low-power. */}
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      {/* Assistant parts render in order so text segments break between tool
          calls and each tool call (and its result/error) shows in place. The
          softened top-left corner anchors the bubble as "from the assistant". */}
      <div className="max-w-[80%] space-y-2 rounded-2xl rounded-tl-sm border border-border/60 bg-gradient-to-b from-surface-2 to-surface px-3.5 py-2 text-sm shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_8px_24px_-16px_hsl(var(--foreground)/0.12)]">
        {message.parts.map((part, index) => {
          if (part.kind === "text") {
            // Assistant text renders markdown so **bold**, lists, and code
            // render. Partial markdown mid-stream renders fine (text accumulates).
            return part.text ? (
              <MarkdownBlock key={`text-${index}`} size="sm">
                {part.text}
              </MarkdownBlock>
            ) : null;
          }
          if (part.kind === "confirm") {
            return (
              <ConfirmCardView
                key={part.toolCallId || index}
                card={part.card}
                onDecision={onDecision}
              />
            );
          }
          if (part.kind === "applied") {
            return (
              <AppliedCardView
                key={part.toolCallId || index}
                card={part.card}
              />
            );
          }
          if (part.kind === "question") {
            return (
              <QuestionCardView
                key={part.toolCallId || index}
                card={part.card}
                onAnswer={onAnswer}
                disabled={busy}
              />
            );
          }
          return (
            <ToolStatusLine
              key={part.toolCallId || index}
              part={part}
              isLowPower={isLowPower}
            />
          );
        })}
        {thinking ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isLowPower ? null : <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
            <span>{thinkingLabel}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The in-app AI chat page (Phase 4). Streams a server-side agent loop;
 * read tools auto-run, mutating/destructive tools surface a confirm card. The
 * model picker defaults to the selected integration's `defaultModel` (§14.6).
 */
export function ChatPage() {
  const ai = usePluginClient(AiApi);
  const queryClient = useQueryClient();
  const integrationsQuery = ai.listChatIntegrations.useQuery();
  const conversationsQuery = ai.listConversations.useQuery();

  const [conversationId, setConversationId] = useState<string | undefined>();
  const [connectionId, setConnectionId] = useState<string | undefined>();
  const [model, setModel] = useState<string | undefined>();
  // The conversation's permission mode (Approve/Auto). Defaults to the safe
  // `approve`; hydrated from the loaded conversation and persisted via
  // updateConversation. Governs the mutate tool branch only (server-side).
  const [permissionMode, setPermissionMode] =
    useState<AiPermissionMode>("approve");
  const [input, setInput] = useState("");
  // Transient "Copied" feedback for the error banner's copy button.
  const [copiedError, setCopiedError] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // The operator's browser timezone, surfaced as a hint and sent with each turn
  // so the assistant resolves bare times ("22:00") in this zone by default.
  const browserTimeZone = useMemo<string | undefined>(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
  }, []);

  const {
    messages,
    setMessages,
    streaming,
    error,
    send,
    sendDecision,
    clearError,
  } = useChatTurn();

  const integrations = useMemo(
    () => integrationsQuery.data?.integrations ?? [],
    [integrationsQuery.data],
  );
  const selectedIntegration = useMemo(
    () => integrations.find((i) => i.connectionId === connectionId),
    [integrations, connectionId],
  );

  // Skills available for chat (builtin + global user skills), for the picker.
  const skillsQuery = ai.listSkills.useQuery({ target: "chat" });
  const chatSkills = useMemo(
    () => skillsQuery.data?.skills ?? [],
    [skillsQuery.data],
  );
  const [skillId, setSkillId] = useState<string | undefined>();
  const [skillBrowserOpen, setSkillBrowserOpen] = useState(false);
  const activeSkill = useMemo(
    () => chatSkills.find((s) => s.id === skillId),
    [chatSkills, skillId],
  );
  const applySkill = (id?: string) => {
    setSkillId(id);
    setSkillBrowserOpen(false);
    const skill = id ? chatSkills.find((s) => s.id === id) : undefined;
    if (skill?.promptTemplate && input.trim().length === 0) {
      setInput(skill.promptTemplate);
    }
  };

  const createConversation = ai.createConversation.useMutation();
  const updateConversation = ai.updateConversation.useMutation();
  const archiveConversation = ai.archiveConversation.useMutation();
  // The conversation queued for the delete (archive) confirmation modal.
  const [pendingDelete, setPendingDelete] = useState<
    { id: string; title: string | null } | undefined
  >();
  const [loadId, setLoadId] = useState<string | undefined>();
  const loadedConversation = ai.getConversation.useQuery(
    { id: loadId ?? "" },
    { enabled: Boolean(loadId), gcTime: 0 },
  );

  // Default the picker to the first integration + its defaultModel (§14.6).
  // eslint-disable-next-line checkstack/no-state-seed-in-effect -- one-time default selection guarded by `!connectionId`, not editable form state; nothing to clobber once the user (or the load seed) picks a connection.
  useEffect(() => {
    if (!connectionId && integrations.length > 0) {
      setConnectionId(integrations[0].connectionId);
      setModel(integrations[0].defaultModel);
    }
  }, [integrations, connectionId]);

  // When the integration changes, default the model to its defaultModel.
  // Keyed on connectionId (not the derived `selectedIntegration` object) via
  // useInitOnceForKey so a background refetch of `integrations` - which
  // recomputes `selectedIntegration` as a new object for the SAME connection -
  // does not clobber a model the user has since picked manually.
  useInitOnceForKey(selectedIntegration, connectionId, (integration) => {
    setModel(integration.defaultModel);
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const conversations = useMemo(
    () => conversationsQuery.data?.conversations ?? [],
    [conversationsQuery.data],
  );

  const startNewConversation = async () => {
    clearError();
    // Dedupe: if the open conversation is already an empty untitled draft, reuse
    // it instead of spawning another "Untitled chat" row.
    const current = conversations.find((c) => c.id === conversationId);
    const action = decideNewChatAction({
      current: current
        ? { id: current.id, title: current.title }
        : undefined,
      messages: messages.map((m) => ({ text: m.text })),
    });
    if (action.kind === "reuse") {
      setConversationId(action.conversationId);
      setMessages([]);
      return;
    }
    const conv = await createConversation.mutateAsync({
      integrationId: connectionId,
      model,
      permissionMode,
    });
    setConversationId(conv.id);
    setMessages([]);
    // The new conversation must appear in (and highlight within) the sidebar
    // immediately. createConversation auto-invalidates this plugin's queries on
    // success, so the list refetches; setting conversationId above makes the new
    // row the active/highlighted one.
  };

  const openConversation = (id: string) => {
    clearError();
    setLoadId(id);
  };

  // Soft-delete (archive) the confirmed conversation: the row + transcript are
  // retained server-side, the chat just disappears from the sidebar. If the
  // archived chat was the open one, clear the view back to the empty state.
  const confirmDelete = async () => {
    const target = pendingDelete;
    if (!target) return;
    await archiveConversation.mutateAsync({ id: target.id });
    setPendingDelete(undefined);
    if (target.id === conversationId) {
      setConversationId(undefined);
      setLoadId(undefined);
      setMessages([]);
    }
  };

  // When a conversation loads, hydrate the local message list from its
  // persisted transcript (shared Postgres — readable on any pod). Seed ONCE per
  // conversation id via useInitOnceForKey (frontend/query-invalidation Pillar 3):
  // a naive `useEffect([data])` would re-seed on every background refetch (the
  // whole-plugin invalidation after each turn, window refocus, etc.), rebuilding
  // messages from the TEXT-ONLY transcript and wiping the just-streamed turn's
  // confirm cards and tool-step parts (those live only in client state). Keying
  // on the conversation id makes background refetches of the same chat no-ops.
  useInitOnceForKey(
    loadedConversation.data,
    loadedConversation.data?.conversation.id,
    (result) => {
      setConversationId(result.conversation.id);
      if (result.conversation.model) setModel(result.conversation.model);
      if (result.conversation.integrationId)
        setConnectionId(result.conversation.integrationId);
      setPermissionMode(
        deriveModeToggleValue({
          conversationMode: result.conversation.permissionMode,
        }),
      );
      setMessages(
        result.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m): ChatMessage => {
            const text =
              typeof m.content.text === "string" ? m.content.text : "";
            const role = m.role === "user" ? "user" : "assistant";
            // The persisted transcript only stores rendered text (tool steps
            // live in `modelMessages` for replay, not for display), so a
            // reloaded assistant turn is a single text part.
            return {
              id: m.id,
              role,
              text,
              parts:
                role === "assistant" && text ? [{ kind: "text", text }] : [],
              streaming: false,
            };
          }),
      );
    },
  );

  const onSend = async () => {
    if (!input.trim() || !connectionId) return;
    let convId = conversationId;
    if (!convId) {
      const conv = await createConversation.mutateAsync({
        integrationId: connectionId,
        model,
        permissionMode,
      });
      convId = conv.id;
      setConversationId(conv.id);
    }
    const text = input;
    setInput("");
    await send({ conversationId: convId, connectionId, model, text, skillId });
    // The chat turn streams via a raw fetch (not an oRPC mutation), so it does
    // not auto-invalidate this plugin's queries. After the turn completes the
    // backend may have set an auto-title on a previously untitled conversation,
    // so refresh this plugin's queries to pick it up. No polling loop. Whole-
    // plugin invalidation is the documented default (frontend/query-invalidation
    // Pillar 2); the getConversation refetch it triggers is harmless because the
    // message hydration below seeds ONCE per conversation via useInitOnceForKey
    // (Pillar 3) and so cannot clobber the just-streamed turn's confirm cards /
    // tool-step parts (which live only in client state, never in the transcript).
    void queryClient.invalidateQueries({
      queryKey: [[pluginMetadata.pluginId]],
    });
  };

  // The operator clicked a chip (or typed) on an `askOperator` question card.
  // Send that answer as their next user message - the same path as typing it
  // and hitting send. A question card only appears inside an existing
  // conversation, so `conversationId` is set; guard on `streaming` so a click
  // cannot race an in-flight turn.
  const onAnswer = (answer: string) => {
    const text = answer.trim();
    if (!text || !connectionId || !conversationId || streaming) return;
    void send({ conversationId, connectionId, model, text, skillId }).then(() =>
      queryClient.invalidateQueries({
        queryKey: [[pluginMetadata.pluginId]],
      }),
    );
  };

  // After the operator applies/declines a confirm card, stream the model's
  // acknowledgment so the conversation continues instead of dead-ending on
  // "waiting for your confirmation". The apply itself already ran via applyTool
  // (inside ConfirmCardView); this only drives the model's reaction.
  const handleDecision = (decision: {
    token: string;
    decision: "apply" | "decline";
  }) => {
    if (!conversationId || !connectionId) return;
    void sendDecision({
      conversationId,
      connectionId,
      model,
      token: decision.token,
      decision: decision.decision,
    });
  };

  // Change the permission mode: update local state immediately, and persist to
  // the loaded conversation (owner-scoped) when one is open. A brand-new chat
  // with no conversation yet just keeps the local choice, which is then sent on
  // the create call (onSend / startNewConversation). updateConversation is an
  // oRPC mutation so it auto-invalidates this plugin's queries on success.
  const onModeChange = (next: AiPermissionMode) => {
    setPermissionMode(next);
    const update = buildModeUpdate({
      conversationId,
      currentMode: permissionMode,
      nextMode: next,
    });
    if (update) void updateConversation.mutateAsync(update);
  };

  // Copy the FULL error text (the provider's HTTP body) to the clipboard so the
  // operator can forward it, even though the banner only shows a one-line digest.
  const copyError = async () => {
    if (!error) return;
    try {
      await navigator.clipboard.writeText(error);
      setCopiedError(true);
      setTimeout(() => setCopiedError(false), 1500);
    } catch {
      // Clipboard API unavailable (non-secure context); silently no-op.
    }
  };

  // The picker always offers the connection's defaultModel (first) followed by
  // its allowlist, de-duplicated. With no allowlist this is just [defaultModel],
  // so the picker stays a tidy Select rather than a free-text field.
  const modelOptions = useMemo(
    () =>
      buildModelOptions({
        defaultModel: selectedIntegration?.defaultModel,
        availableModels: selectedIntegration?.availableModels,
      }),
    [selectedIntegration],
  );

  return (
    <PageLayout
      title="AI assistant"
      subtitle="Chat with Checkstack's built-in assistant. It can read incidents, health checks, and anomalies, and propose automations for you to confirm."
      icon={Sparkles}
      fillHeight
    >
      {/* `flex-1 min-h-0` fills the fillHeight content area (no viewport math),
          so only the message list scrolls - the page itself never does, even
          when the subtitle wraps. */}
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 flex-1 min-h-0">
        {/* Conversation sidebar */}
        <Card className="overflow-hidden flex flex-col">
          <CardContent className="p-2 flex flex-col gap-2 overflow-y-auto">
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start"
              onClick={startNewConversation}
            >
              <span className="mr-2 flex size-5 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Plus className="h-3.5 w-3.5" />
              </span>
              New chat
            </Button>
            {conversations.map((c) => {
              const active = c.id === conversationId;
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group relative flex items-center gap-1 rounded-md px-2.5 py-2 transition-colors hover:bg-surface-inset",
                    active && "bg-surface-inset font-medium",
                  )}
                >
                  {/* Active conversation: a thin left accent stripe so the open
                      chat is unmistakable beyond a faint fill. */}
                  {active ? (
                    <span
                      className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
                      aria-hidden
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openConversation(c.id)}
                    className="flex-1 truncate text-left text-sm"
                  >
                    {c.title ?? "Untitled chat"}
                  </button>
                  <button
                    type="button"
                    aria-label="Delete chat"
                    title="Delete"
                    onClick={() =>
                      setPendingDelete({ id: c.id, title: c.title })
                    }
                    className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Chat panel */}
        <Card className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b p-2">
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Integration" />
              </SelectTrigger>
              <SelectContent>
                {integrations.map((i) => (
                  <SelectItem key={i.connectionId} value={i.connectionId}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Permission mode: Approve surfaces a confirm card for changes; Auto
                applies non-destructive changes immediately. Destructive actions
                always require confirmation regardless of this setting. */}
            <Select
              value={permissionMode}
              onValueChange={(v) =>
                onModeChange(deriveModeToggleValue({ conversationMode: v }))
              }
            >
              <SelectTrigger
                className="w-36"
                title="Approve: confirm each change. Auto: apply non-destructive changes immediately. Destructive actions always need confirmation."
              >
                <SelectValue placeholder="Mode" />
              </SelectTrigger>
              <SelectContent>
                {PERMISSION_MODE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {integrationsQuery.isLoading ? (
              <LoadingSpinner />
            ) : integrations.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="w-8 h-8" />}
                title="No AI integration configured"
                description="Add an OpenAI-compatible connection in Settings to start chatting."
              />
            ) : messages.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="w-8 h-8" />}
                title="Ask the assistant"
                description="Ask how Checkstack works or have it do a task for you. Pick a prompt to get started - you can edit it before sending."
                actions={
                  <div className="flex flex-wrap justify-center gap-2">
                    {CHAT_EXAMPLE_PROMPTS.map((prompt) => (
                      <Button
                        key={prompt}
                        size="sm"
                        variant="outline"
                        onClick={() => setInput(prompt)}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                }
              />
            ) : (
              messages.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  onDecision={handleDecision}
                  onAnswer={onAnswer}
                  busy={streaming}
                />
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* Persistent error banner: a failed turn is never persisted
              server-side (onFinish does not run on error), so the in-bubble
              error would be wiped by the post-turn transcript refetch. This
              banner reads from the durable hook `error` state instead, so the
              operator can read and copy the provider's actual message (e.g. a
              400 `invalid_prompt` body). Dismiss with the X or by sending again. */}
          {error ? (
            <div className="border-t p-2">
              <Alert variant="error">
                <AlertIcon>
                  <AlertCircle className="h-4 w-4" />
                </AlertIcon>
                {/* Single-line digest: the full provider body can be thousands
                    of chars (a JSON validation dump), so truncate it here and
                    expose the whole thing via Copy + the native hover tooltip. */}
                <AlertContent className="min-w-0 flex-1">
                  <AlertTitle>The assistant could not respond</AlertTitle>
                  <AlertDescription>
                    <span className="block truncate" title={error}>
                      {error}
                    </span>
                  </AlertDescription>
                </AlertContent>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-destructive hover:text-destructive"
                    onClick={() => void copyError()}
                  >
                    {copiedError ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copiedError ? "Copied" : "Copy"}
                  </Button>
                  <button
                    type="button"
                    aria-label="Dismiss error"
                    onClick={clearError}
                    className="text-destructive/70 hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </Alert>
            </div>
          ) : null}

          <div className="border-t p-2 space-y-2">
            {/* Active-skill banner: makes the persona EXPLICIT — it names the
                skill and describes how it changes the assistant's behavior, so
                the system-prompt framing is never hidden. Clearable. */}
            {activeSkill && (
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    Skill active: {activeSkill.name}
                  </div>
                  <div className="text-muted-foreground">
                    {activeSkill.description}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  title="Turn off this skill"
                  onClick={() => setSkillId(undefined)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            <div className="flex gap-2">
              <Textarea
                className="flex-1 resize-none"
                rows={2}
                placeholder="Message the assistant..."
                value={input}
                disabled={streaming || integrations.length === 0}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onSend();
                  }
                }}
              />
              <div className="flex flex-col gap-2">
                <Button
                  size="icon"
                  onClick={() => void onSend()}
                  disabled={streaming || !input.trim() || !connectionId}
                  title="Send message"
                  aria-label="Send message"
                >
                  <Send className="w-4 h-4" />
                </Button>
                {/* Skill picker lives WITH the composer (a per-message authoring
                    choice), not in the connection/model header. Icon-only,
                    stacked under Send; opens a browsable catalogue so each
                    skill's description is visible BEFORE choosing. Tinted when
                    a skill is active. */}
                {chatSkills.length > 0 && (
                  <Button
                    variant="outline"
                    size="icon"
                    className={activeSkill ? "border-primary text-primary" : ""}
                    onClick={() => setSkillBrowserOpen(true)}
                    title={
                      activeSkill
                        ? `Skill active: ${activeSkill.name} - change or turn off`
                        : "Browse skills (reusable prompts) and apply one"
                    }
                    aria-label="Browse skills"
                  >
                    <Sparkles className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
          {browserTimeZone ? (
            <p className="px-2 pb-2 -mt-1 text-xs text-muted-foreground">
              Times you mention are interpreted in your timezone (
              {browserTimeZone}).
            </p>
          ) : null}
        </Card>
      </div>

      {/* Delete = soft archive: the row is retained server-side for abuse
          introspection but disappears from the sidebar. Labeled "Delete". */}
      <ConfirmationModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(undefined)}
        onConfirm={() => void confirmDelete()}
        title="Delete chat"
        message={`Delete "${
          pendingDelete?.title ?? "Untitled chat"
        }"? This removes it from your list.`}
        confirmText="Delete"
        variant="danger"
        isLoading={archiveConversation.isPending}
      />

      {/* Skill catalogue: browse every available chat skill WITH its
          description before choosing, instead of picking blind from a list. */}
      <Dialog open={skillBrowserOpen} onOpenChange={setSkillBrowserOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Apply a skill</DialogTitle>
            <DialogDescription>
              A skill shapes how the assistant responds for this conversation.
              Pick one to apply its guidance; you can turn it off any time.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {activeSkill && (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => applySkill()}
              >
                <X className="mr-2 h-4 w-4" />
                Turn off the active skill
              </Button>
            )}
            {chatSkills.map((skill) => {
              const isActive = skill.id === skillId;
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => applySkill(skill.id)}
                  className={`flex w-full flex-col gap-1 rounded-md border p-3 text-left transition-colors hover:border-primary ${
                    isActive ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                    <span className="font-medium">{skill.name}</span>
                    {isActive && (
                      <Badge variant="secondary" className="ml-auto">
                        Active
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {skill.description}
                  </p>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
