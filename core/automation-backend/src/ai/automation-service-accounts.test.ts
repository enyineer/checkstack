import { describe, expect, test, mock } from "bun:test";
import type { AuthUser, RpcClient } from "@checkstack/backend-api";
import { createAutomationListServiceAccountsTool } from "./automation-service-accounts";

/** A bindable application as the auth plugin's `getBindableApplications` returns it. */
interface BindableApp {
  id: string;
  name: string;
  description?: string | null;
  accessRules?: string[];
}

/**
 * A fake user-scoped client whose AuthApi surface returns the given bindable
 * applications via `getBindableApplications` - the SAME single, user-callable
 * RPC the production tool uses. The subset-of-caller-rules filter lives
 * server-side in that proc (it is `userType: "user"`, `access: []`), so the
 * tool itself does no filtering; the fake therefore returns the already-filtered
 * list, exactly as the real router would.
 *
 * `getApplications` / `enrichApplicationPrincipal` are wired to THROW: the tool
 * must never reach for them. `enrichApplicationPrincipal` is `userType:
 * "service"` and the user-scoped client re-authenticates as a real user, so any
 * call to it would be rejected with FORBIDDEN in production; `getApplications`
 * requires the `applications` manage rule the tool is not gated by. A throw here
 * surfaces a regression to either as a failing test rather than a hidden trap.
 */
function fakeAuthRpcClient({ apps }: { apps: BindableApp[] }): RpcClient {
  return {
    forPlugin: () => ({
      getBindableApplications: mock(() =>
        Promise.resolve(
          apps.map(({ id, name, description, accessRules }) => ({
            id,
            name,
            description: description ?? null,
            accessRules: accessRules ?? [],
          })),
        ),
      ),
      getApplications: mock(() => {
        throw new Error(
          "getApplications must not be called - it requires the applications manage rule the tool is not gated by; use getBindableApplications.",
        );
      }),
      enrichApplicationPrincipal: mock(() => {
        throw new Error(
          "enrichApplicationPrincipal must not be called - it is userType:\"service\" and the user-scoped client is rejected with FORBIDDEN; use getBindableApplications.",
        );
      }),
    }),
  } as unknown as RpcClient;
}

function user({ accessRules }: { accessRules: string[] }): AuthUser {
  return { type: "user", id: "u1", accessRules };
}

describe("automation.listServiceAccounts tool", () => {
  test("declares read effect gated by the automation read rule", () => {
    const tool = createAutomationListServiceAccountsTool();
    expect(tool.name).toBe("automation.listServiceAccounts");
    expect(tool.effect).toBe("read");
    expect(tool.requiredAccessRules).toEqual(["automation.automation.read"]);
    expect(tool.dryRun).toBeUndefined();
  });

  test("surfaces the bindable applications the auth plugin returns", async () => {
    const tool = createAutomationListServiceAccountsTool();
    const out = await tool.execute({
      principal: user({ accessRules: ["incident.read", "incident.manage"] }),
      input: {},
      rpcClient: fakeAuthRpcClient({
        apps: [
          {
            id: "bindable",
            name: "Subset app",
            description: "ok",
            accessRules: ["incident.read"],
          },
        ],
      }),
    });
    expect(out.serviceAccounts.map((s) => s.id)).toEqual(["bindable"]);
    expect(out.serviceAccounts[0]).toEqual({
      id: "bindable",
      name: "Subset app",
      description: "ok",
      accessRules: ["incident.read"],
    });
    expect(out.note).toMatch(/runAs/i);
  });

  test("omits the description field when the application has none", async () => {
    const tool = createAutomationListServiceAccountsTool();
    const out = await tool.execute({
      principal: user({ accessRules: ["*"] }),
      input: {},
      rpcClient: fakeAuthRpcClient({
        apps: [
          { id: "a", name: "A" },
          { id: "b", name: "B", description: null },
        ],
      }),
    });
    expect(out.serviceAccounts).toEqual([
      { id: "a", name: "A", accessRules: [] },
      { id: "b", name: "B", accessRules: [] },
    ]);
  });

  test("surfaces each account's accessRules and asks when multiple are available", async () => {
    const tool = createAutomationListServiceAccountsTool();
    const out = await tool.execute({
      principal: user({ accessRules: ["*"] }),
      input: {},
      rpcClient: fakeAuthRpcClient({
        apps: [
          { id: "a", name: "Jira SA", accessRules: ["integration-jira.create_issue.manage"] },
          { id: "b", name: "Notify SA", accessRules: ["notification.send"] },
        ],
      }),
    });
    expect(out.serviceAccounts.find((s) => s.id === "a")?.accessRules).toEqual([
      "integration-jira.create_issue.manage",
    ]);
    // With more than one bindable account, the model is told to ASK which to use.
    expect(out.note).toMatch(/ask the operator/i);
    expect(out.note).toMatch(/requiredAccessRules/);
  });

  test("uses getBindableApplications and never the service-only enrich RPC", async () => {
    const tool = createAutomationListServiceAccountsTool();
    const getBindableApplications = mock(() =>
      Promise.resolve([{ id: "a", name: "A", description: null, accessRules: [] }]),
    );
    const enrichApplicationPrincipal = mock(() =>
      Promise.reject(new Error("must not be called")),
    );
    const getApplications = mock(() =>
      Promise.reject(new Error("must not be called")),
    );
    const rpcClient = {
      forPlugin: () => ({
        getBindableApplications,
        enrichApplicationPrincipal,
        getApplications,
      }),
    } as unknown as RpcClient;

    await tool.execute({
      principal: user({ accessRules: ["*"] }),
      input: {},
      rpcClient,
    });

    expect(getBindableApplications).toHaveBeenCalledTimes(1);
    expect(enrichApplicationPrincipal).not.toHaveBeenCalled();
    expect(getApplications).not.toHaveBeenCalled();
  });

  test("returns guidance to not invent a runAs when none are bindable", async () => {
    const tool = createAutomationListServiceAccountsTool();
    const out = await tool.execute({
      principal: user({ accessRules: [] }),
      input: {},
      rpcClient: fakeAuthRpcClient({ apps: [] }),
    });
    expect(out.serviceAccounts).toEqual([]);
    expect(out.note).toMatch(/do not invent a runAs|never invent a runAs/i);
  });
});
