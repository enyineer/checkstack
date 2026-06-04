import { describe, expect, test } from "bun:test";
import { createMcpConnectionRegistry } from "./connection-registry";

describe("createMcpConnectionRegistry (pod-local bookkeeping)", () => {
  test("opens, reads, and closes a connection", () => {
    const reg = createMcpConnectionRegistry();
    const conn = reg.open({ sessionId: "s1", principalId: "u1" });
    expect(conn.sessionId).toBe("s1");
    expect(reg.get("s1")?.principalId).toBe("u1");
    expect(reg.size()).toBe(1);
    reg.close("s1");
    expect(reg.get("s1")).toBeUndefined();
    expect(reg.size()).toBe(0);
  });

  test("tracks multiple concurrent connections independently", () => {
    const reg = createMcpConnectionRegistry();
    reg.open({ sessionId: "a", principalId: "u1" });
    reg.open({ sessionId: "b", principalId: "u2" });
    expect(reg.size()).toBe(2);
    reg.close("a");
    expect(reg.size()).toBe(1);
    expect(reg.get("b")?.principalId).toBe("u2");
  });
});
