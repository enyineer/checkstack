import { useCallback, useRef, useState } from "react";
import { useApi, fetchApiRef } from "@checkstack/frontend-api";
import { pluginMetadata } from "@checkstack/ai-common";
import { extractErrorMessage } from "@checkstack/common";
import {
  appendUserMessage,
  startAssistantMessage,
  applyStreamEvent,
  finishAssistantMessage,
  type ChatMessage,
} from "./chat-state";
import { readChatStream } from "./stream-parser";

/** Generate a client-side message id (crypto.randomUUID is widely available). */
function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * React hook that drives ONE streaming chat turn against /api/ai/chat. The
 * heavy lifting (SSE parsing, state folding) lives in DOM-free, unit-tested
 * modules (`stream-parser`, `chat-state`); this hook only wires them to React
 * state and the platform `fetch` (which carries auth + base URL). Credentials
 * never reach the browser — the response is a token/tool-event stream only.
 */
export function useChatTurn({
  initialMessages = [],
}: {
  initialMessages?: ChatMessage[];
} = {}) {
  const fetchApi = useApi(fetchApiRef);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const aborter = useRef<AbortController | undefined>();

  // Shared streaming driver: POST `body` to /chat, start a fresh assistant
  // message (optionally appending a user message first), and fold the SSE
  // events into it. Used by both `send` (a user turn) and `sendDecision` (a
  // confirm-card acknowledgment, which has no user bubble).
  const runStream = useCallback(
    async ({
      body,
      userText,
    }: {
      body: Record<string, unknown>;
      userText?: string;
    }) => {
      setError(undefined);
      setStreaming(true);
      setMessages((prev) => {
        const base =
          userText === undefined
            ? prev
            : appendUserMessage({ messages: prev, id: newId(), text: userText });
        return startAssistantMessage({ messages: base, id: newId() });
      });
      const controller = new AbortController();
      aborter.current = controller;
      try {
        const response = await fetchApi
          .forPlugin(pluginMetadata.pluginId)
          .fetch("/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        if (!response.ok || !response.body) {
          const detail = await response.text().catch(() => "");
          throw new Error(detail || `Chat failed (${response.status})`);
        }
        for await (const event of readChatStream(response.body)) {
          // An in-stream error (the server's onError surfaced a provider/stream
          // failure, e.g. a 400 `invalid_prompt`) arrives as a normal stream
          // event, NOT a thrown exception, so the catch below never runs. Lift
          // it into the durable `error` state so a post-turn message refetch
          // (which re-hydrates from the persisted transcript that never captured
          // this failed turn) cannot wipe it from view.
          if (event.type === "error") setError(event.message);
          setMessages((prev) => applyStreamEvent({ messages: prev, event }));
        }
      } catch (error_) {
        const message = extractErrorMessage(error_, "Chat turn failed");
        setError(message);
        setMessages((prev) =>
          applyStreamEvent({ messages: prev, event: { type: "error", message } }),
        );
      } finally {
        setMessages((prev) => finishAssistantMessage({ messages: prev }));
        setStreaming(false);
        aborter.current = undefined;
      }
    },
    [fetchApi],
  );

  const send = useCallback(
    ({
      conversationId,
      connectionId,
      model,
      text,
    }: {
      conversationId: string;
      connectionId: string;
      model?: string;
      text: string;
    }) =>
      runStream({
        body: { conversationId, connectionId, model, message: text },
        userText: text,
      }),
    [runStream],
  );

  // Stream the model's acknowledgment after the operator applies/declines a
  // confirm card. The actual apply ran via `applyTool`; this only makes the
  // model react (no user bubble is added).
  const sendDecision = useCallback(
    ({
      conversationId,
      connectionId,
      model,
      token,
      decision,
    }: {
      conversationId: string;
      connectionId: string;
      model?: string;
      token: string;
      decision: "apply" | "decline";
    }) =>
      runStream({
        body: {
          conversationId,
          connectionId,
          model,
          decision: { token, kind: decision },
        },
      }),
    [runStream],
  );

  const stop = useCallback(() => {
    aborter.current?.abort();
  }, []);

  const clearError = useCallback(() => setError(undefined), []);

  return {
    messages,
    setMessages,
    streaming,
    error,
    send,
    sendDecision,
    stop,
    clearError,
  };
}
