import { useEffect, useMemo, useRef, useState } from "react";
import {
  PageLayout,
  Card,
  CardContent,
  Button,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
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
import { buildModelOptions } from "../lib/model-options.logic";
import { decideNewChatAction } from "../lib/new-chat.logic";
import {
  PERMISSION_MODE_OPTIONS,
  deriveModeToggleValue,
  buildModeUpdate,
} from "../lib/mode-toggle.logic";
import type { ChatMessage, AssistantPart } from "../lib/chat-state";

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
  return (
    <div
      className={`flex items-center gap-1.5 text-xs ${
        isError ? "text-destructive" : "text-muted-foreground"
      }`}
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
        <Check className="h-3 w-3 shrink-0" />
      )}
      <span className="font-medium">{part.toolName}</span>
      {part.status === "running" ? <span>running...</span> : null}
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
}: {
  message: ChatMessage;
  onDecision: (decision: {
    token: string;
    decision: "apply" | "decline";
  }) => void;
}) {
  const { isLowPower } = usePerformance();
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        {/* User text stays plain, preserving newlines. */}
        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
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

  return (
    <div className="flex justify-start">
      {/* Assistant parts render in order so text segments break between tool
          calls and each tool call (and its result/error) shows in place. */}
      <div className="max-w-[80%] space-y-2 rounded-lg bg-muted px-3 py-2 text-sm">
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
            <span>Thinking...</span>
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
  useEffect(() => {
    if (!connectionId && integrations.length > 0) {
      setConnectionId(integrations[0].connectionId);
      setModel(integrations[0].defaultModel);
    }
  }, [integrations, connectionId]);

  // When the integration changes, default the model to its defaultModel.
  useEffect(() => {
    if (selectedIntegration) setModel(selectedIntegration.defaultModel);
  }, [selectedIntegration]);

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
    await send({ conversationId: convId, connectionId, model, text });
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
    >
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 h-[calc(100vh-220px)]">
        {/* Conversation sidebar */}
        <Card className="overflow-hidden flex flex-col">
          <CardContent className="p-2 flex flex-col gap-2 overflow-y-auto">
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={startNewConversation}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> New chat
            </Button>
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded px-2 py-1 hover:bg-muted ${
                  c.id === conversationId ? "bg-muted font-medium" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => openConversation(c.id)}
                  className="flex-1 text-left text-sm truncate"
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
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
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
                description="Try: 'Summarize the open incidents' or 'Draft an automation that pages on-call when the API health check fails.'"
              />
            ) : (
              messages.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  onDecision={handleDecision}
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

          <div className="border-t p-2 flex gap-2">
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
            <Button
              onClick={() => void onSend()}
              disabled={streaming || !input.trim() || !connectionId}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
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
    </PageLayout>
  );
}
