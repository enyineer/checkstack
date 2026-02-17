import { describe, expect, it, mock } from "bun:test";
import { shellProvider, type ShellConfig } from "./shell-provider";

const mockLogger = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
};

describe("ShellProvider Security", () => {
  it("should not leak sensitive environment variables to child process", async () => {
    process.env.TEST_SECRET_KEY = "SUPER_SECRET_KEY_DO_NOT_LEAK";

    const context = {
      event: {
        eventId: "test-id",
        timestamp: new Date().toISOString(),
        deliveryId: "del-id",
        payload: {},
      },
      subscription: {
        id: "sub-id",
        name: "sub-name",
      },
      providerConfig: {
        script: 'echo "SECRET=$TEST_SECRET_KEY"',
        timeout: 5000,
      } as ShellConfig,
      logger: mockLogger,
    };

    const result = await shellProvider.deliver(context as any);

    // Cleanup
    delete process.env.TEST_SECRET_KEY;

    expect(result.success).toBe(true);
    // If leaked, output will be "SECRET=SUPER_SECRET_KEY_DO_NOT_LEAK"
    // If safe, output will be "SECRET="
    expect(result.externalId).toBe("SECRET=");
  });
});
