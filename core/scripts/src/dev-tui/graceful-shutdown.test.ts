import { describe, it, expect } from "bun:test";
import { createGracefulShutdown } from "./graceful-shutdown.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("createGracefulShutdown", () => {
  it("runs shutdown to completion BEFORE finalize (no stale children on exit)", async () => {
    const order: string[] = [];
    const handler = createGracefulShutdown({
      shutdown: async () => {
        await tick();
        order.push("shutdown");
      },
      finalize: () => order.push("finalize"),
    });

    handler();
    await tick();
    await tick();

    expect(order).toEqual(["shutdown", "finalize"]);
  });

  it("is idempotent: repeated triggers (unmount + signal) shut down once", async () => {
    let shutdowns = 0;
    let finalizes = 0;
    const handler = createGracefulShutdown({
      shutdown: async () => {
        shutdowns += 1;
      },
      finalize: () => {
        finalizes += 1;
      },
    });

    handler();
    handler();
    handler();
    await tick();

    expect(shutdowns).toBe(1);
    expect(finalizes).toBe(1);
  });

  it("still finalizes when shutdown rejects (terminal restored, process exits)", async () => {
    let finalized = false;
    const handler = createGracefulShutdown({
      shutdown: async () => {
        throw new Error("kill failed");
      },
      finalize: () => {
        finalized = true;
      },
    });

    handler();
    await tick();

    expect(finalized).toBe(true);
  });
});
