import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Versioned } from "@checkstack/backend-api";

import { createNotificationStrategyRegistry } from "./strategy-registry";

import type { NotificationStrategy } from "@checkstack/backend-api";

function createStrategy(id: string, displayName: string): NotificationStrategy {
  return {
    id,
    displayName,
    description: `Test strategy ${id}`,
    contactResolution: { type: "auth-email" },
    config: new Versioned({ version: 1, schema: z.object({}) }),
    send: async () => ({ success: true }),
  };
}

describe("createNotificationStrategyRegistry", () => {
  it("derives accessRuleId from the emitted access rule (no id drift)", () => {
    const registry = createNotificationStrategyRegistry();
    registry.register(createStrategy("smtp", "SMTP Email"), {
      pluginId: "email",
    } as Parameters<typeof registry.register>[1]);

    const [strategy] = registry.getStrategies();
    const [emitted] = registry.getNewAccessRules();

    expect(strategy?.accessRuleId).toBe("email.strategy.smtp.manage");
    expect(emitted?.accessRule.id).toBe(strategy?.accessRuleId);
    expect(emitted?.ownerPluginId).toBe("email");
  });

  it("emits qualified, plugin-prefixed manage rules per owner plugin", () => {
    const registry = createNotificationStrategyRegistry();
    const metadata = { pluginId: "email" } as Parameters<
      typeof registry.register
    >[1];
    registry.register(createStrategy("smtp", "SMTP Email"), metadata);
    registry.register(createStrategy("sms", "SMS"), metadata);

    const rules = registry.getNewAccessRules().map((r) => r.accessRule);
    expect(rules.map((r) => r.id)).toEqual([
      "email.strategy.smtp.manage",
      "email.strategy.sms.manage",
    ]);
    expect(rules.every((r) => r.pluginId === "email")).toBe(true);
  });

  it("getStrategiesForUser matches exact grants and the admin wildcard", () => {
    const registry = createNotificationStrategyRegistry();
    const metadata = { pluginId: "email" } as Parameters<
      typeof registry.register
    >[1];
    registry.register(createStrategy("smtp", "SMTP Email"), metadata);
    registry.register(createStrategy("sms", "SMS"), metadata);

    const byId = (rules: Set<string>) =>
      new Set(
        registry
          .getStrategiesForUser(rules)
          .map((s) => s.qualifiedId),
      );

    expect(byId(new Set(["*"]))).toEqual(
      new Set(["email.smtp", "email.sms"]),
    );
    expect(byId(new Set(["email.strategy.smtp.manage"]))).toEqual(
      new Set(["email.smtp"]),
    );
    expect(byId(new Set(["email.strategy.smtp.use"]))).toEqual(new Set());
    expect(byId(new Set())).toEqual(new Set());
  });
});
