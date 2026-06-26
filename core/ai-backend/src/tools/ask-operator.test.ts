import { describe, expect, test } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createAskOperatorTool } from "./ask-operator";

const principal: AuthUser = { type: "user", id: "u1", accessRules: [] };
const rpcClient = {} as unknown as RpcClient;

describe("ai.askOperator tool", () => {
  test("is a read tool gated by a chat-use access rule", () => {
    const tool = createAskOperatorTool();
    expect(tool.name).toBe("askOperator");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules.length).toBeGreaterThan(0);
    expect(typeof tool.description).toBe("string");
    // The model must know this ends the turn.
    expect(tool.description).toContain("ENDS your turn");
  });

  test("execute returns a __question card with options normalized (value defaults to label)", async () => {
    const tool = createAskOperatorTool();
    const result = await tool.execute({
      input: {
        question: "Which system should this monitor?",
        options: [
          { label: "Payments API" },
          { label: "Create a new system", value: "new" },
        ],
        allowFreeText: true,
      },
      principal,
      rpcClient,
    });

    expect(result.__question).toBe(true);
    expect(result.question).toBe("Which system should this monitor?");
    expect(result.options).toEqual([
      { label: "Payments API", value: "Payments API" },
      { label: "Create a new system", value: "new" },
    ]);
    expect(result.allowFreeText).toBe(true);
    // The model-facing stop instruction (ignored by the frontend).
    expect(typeof result.note).toBe("string");
  });
});
