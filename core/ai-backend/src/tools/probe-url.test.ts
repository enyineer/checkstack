import { describe, expect, test } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createProbeUrlTool } from "./probe-url";

const principal: AuthUser = {
  type: "user",
  id: "u1",
  accessRules: ["ai.chat.read"],
};

// probeUrl never touches the RPC client (it only issues an outbound fetch), so a
// never-called stub satisfies the user-scoped `rpcClient` arg of `execute`.
const rpcClient = {
  forPlugin: () => {
    throw new Error("probeUrl must not call the RPC client");
  },
} as unknown as RpcClient;

describe("ai.probeUrl tool", () => {
  test("is a read tool gated by the chat-read surface", () => {
    const tool = createProbeUrlTool();
    expect(tool.name).toBe("probeUrl");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["ai.chat.read"]);
  });

  test("refuses an internal/loopback target before any network call", async () => {
    const tool = createProbeUrlTool();
    await expect(
      tool.execute({ input: { url: "http://localhost:8080/", method: "GET" }, principal, rpcClient }),
    ).rejects.toThrow(/loopback|internal/);
  });

  test("refuses the cloud metadata IP before any network call", async () => {
    const tool = createProbeUrlTool();
    await expect(
      tool.execute({
        input: { url: "http://169.254.169.254/latest/meta-data", method: "GET" },
        principal,
        rpcClient,
      }),
    ).rejects.toThrow(/private\/reserved/);
  });

  test("refuses a non-http(s) scheme", async () => {
    const tool = createProbeUrlTool();
    await expect(
      tool.execute({ input: { url: "file:///etc/passwd", method: "GET" }, principal, rpcClient }),
    ).rejects.toThrow(/http and https/);
  });
});
