import { describe, it, expect, mock } from "bun:test";
import { MIN_MASKABLE_LENGTH } from "@checkstack/secrets-common";
import type { Logger } from "@checkstack/backend-api";
import { createSecretAdminService } from "./admin-service";
import type { SecretBackend } from "./secret-backend";

function fakeBackend(): SecretBackend {
  const store: Record<string, string> = {};
  const backend: SecretBackend = {
    id: "local",
    get: async ({ name }: { name: string }) => store[name],
    set: async ({ name, value }: { name: string; value: string }) => {
      store[name] = value;
    },
    delete: async ({ name }: { name: string }) => {
      delete store[name];
    },
    list: async () =>
      Object.keys(store).map((name) => ({
        id: name,
        name,
        description: null,
        hasValue: true,
        backend: "local",
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
  };
  return backend;
}

function makeService(logger?: Logger) {
  const backend = fakeBackend();
  return createSecretAdminService({
    getActiveBackend: async () => backend,
    onChanged: async () => {},
    logger,
  });
}

describe("L1 — setSecret warns on values too short to auto-redact", () => {
  it("warns when a value is shorter than MIN_MASKABLE_LENGTH", async () => {
    const warn = mock();
    const logger = { warn, info: mock(), error: mock(), debug: mock() };
    const admin = makeService(logger as unknown as Logger);

    const short = "a".repeat(MIN_MASKABLE_LENGTH - 1);
    await admin.setSecret({ name: "API_PIN", value: short });

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0] ?? "");
    expect(message).toContain("API_PIN");
    expect(message).toContain("cannot be auto-redacted");
    // Never echo the value itself.
    expect(message).not.toContain(short);
  });

  it("does NOT warn for a value at or above the threshold", async () => {
    const warn = mock();
    const logger = { warn, info: mock(), error: mock(), debug: mock() };
    const admin = makeService(logger as unknown as Logger);

    await admin.setSecret({
      name: "API_TOKEN",
      value: "x".repeat(MIN_MASKABLE_LENGTH),
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("still stores the secret despite the warning (threshold is not changed)", async () => {
    const admin = makeService();
    const result = await admin.setSecret({ name: "PIN", value: "ab" });
    expect(result.created).toBe(true);
  });
});
