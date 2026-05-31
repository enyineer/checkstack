import { describe, expect, test } from "bun:test";
import {
  buildReplayArtifacts,
  buildReplayContext,
} from "./script-test-replay";

describe("buildReplayArtifacts", () => {
  test("keys by artifact type and by action id", () => {
    const out = buildReplayArtifacts([
      { artifactType: "jira.issue", actionId: "create_issue", data: { key: "P-1" } },
    ]);
    expect(out["jira.issue"]).toEqual({ key: "P-1" });
    expect(out.create_issue).toEqual({ key: "P-1" });
  });

  test("omits the action-id key when actionId is null", () => {
    const out = buildReplayArtifacts([
      { artifactType: "shell_result", actionId: null, data: { exitCode: 0 } },
    ]);
    expect(out.shell_result).toEqual({ exitCode: 0 });
    expect(Object.keys(out)).toEqual(["shell_result"]);
  });

  test("later artifacts of the same key win", () => {
    const out = buildReplayArtifacts([
      { artifactType: "jira.issue", actionId: null, data: { key: "OLD" } },
      { artifactType: "jira.issue", actionId: null, data: { key: "NEW" } },
    ]);
    expect(out["jira.issue"]).toEqual({ key: "NEW" });
  });
});

describe("buildReplayContext", () => {
  const run = {
    triggerEventId: "incident.incident.created",
    triggerPayload: { id: "INC-7", severity: "high" },
  };

  test("builds trigger + artifacts; empty var/no repeat without a snapshot", () => {
    const ctx = buildReplayContext({
      run,
      artifacts: [
        { artifactType: "jira.issue", actionId: "j", data: { key: "P-9" } },
      ],
    });
    expect(ctx.trigger).toEqual({
      event: "incident.incident.created",
      payload: { id: "INC-7", severity: "high" },
    });
    expect(ctx.artifacts).toEqual({
      "jira.issue": { key: "P-9" },
      j: { key: "P-9" },
    });
    expect(ctx.var).toEqual({});
    expect("repeat" in ctx).toBe(false);
  });

  test("pulls var and repeat from an in-flight scope snapshot", () => {
    const ctx = buildReplayContext({
      run,
      artifacts: [],
      scopeSnapshot: {
        vars: { attempts: 2 },
        repeat: { index: 1, item: { name: "b" } },
      },
    });
    expect(ctx.var).toEqual({ attempts: 2 });
    expect(ctx.repeat).toEqual({ index: 1, item: { name: "b" } });
  });

  test("ignores a malformed repeat in the snapshot", () => {
    const ctx = buildReplayContext({
      run,
      artifacts: [],
      scopeSnapshot: { repeat: { item: "no-index" } },
    });
    expect("repeat" in ctx).toBe(false);
  });

  test("ignores a non-object vars snapshot", () => {
    const ctx = buildReplayContext({
      run,
      artifacts: [],
      scopeSnapshot: { vars: "nope" },
    });
    expect(ctx.var).toEqual({});
  });
});
