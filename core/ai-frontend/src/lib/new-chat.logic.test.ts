import { describe, expect, test } from "bun:test";
import {
  isEmptyUntitledChat,
  decideNewChatAction,
} from "./new-chat.logic";

describe("isEmptyUntitledChat", () => {
  test("true for an untitled chat with no messages", () => {
    expect(
      isEmptyUntitledChat({
        conversation: { id: "c1", title: null },
        messages: [],
      }),
    ).toBe(true);
  });

  test("true when the title is blank/whitespace only", () => {
    expect(
      isEmptyUntitledChat({
        conversation: { id: "c1", title: "   " },
        messages: [],
      }),
    ).toBe(true);
  });

  test("false once the chat has a real title", () => {
    expect(
      isEmptyUntitledChat({
        conversation: { id: "c1", title: "Open incidents" },
        messages: [],
      }),
    ).toBe(false);
  });

  test("false once the chat has a non-blank message", () => {
    expect(
      isEmptyUntitledChat({
        conversation: { id: "c1", title: null },
        messages: [{ text: "hello" }],
      }),
    ).toBe(false);
  });

  test("blank-only messages do not count as content", () => {
    expect(
      isEmptyUntitledChat({
        conversation: { id: "c1", title: null },
        messages: [{ text: "   " }],
      }),
    ).toBe(true);
  });

  test("false when there is no open conversation", () => {
    expect(
      isEmptyUntitledChat({ conversation: undefined, messages: [] }),
    ).toBe(false);
  });
});

describe("decideNewChatAction", () => {
  test("reuses the open empty untitled draft instead of creating a duplicate", () => {
    expect(
      decideNewChatAction({
        current: { id: "c1", title: null },
        messages: [],
      }),
    ).toEqual({ kind: "reuse", conversationId: "c1" });
  });

  test("creates a fresh conversation when the open one has content", () => {
    expect(
      decideNewChatAction({
        current: { id: "c1", title: "Titled" },
        messages: [],
      }),
    ).toEqual({ kind: "create" });
  });

  test("creates a fresh conversation when none is open", () => {
    expect(
      decideNewChatAction({ current: undefined, messages: [] }),
    ).toEqual({ kind: "create" });
  });
});
