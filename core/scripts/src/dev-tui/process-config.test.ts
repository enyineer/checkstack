import { describe, expect, it } from "bun:test";
import { PROCESS_DEFS, getProcessDefs } from "./process-config.ts";

describe("PROCESS_DEFS", () => {
  it("never spawns a long-running task via bun --filter", () => {
    // `bun run --filter` buffers + frames output through its task dashboard
    // instead of streaming raw lines, which defeats the per-line level
    // detection that feeds the Alerts panel. Each watcher must run its own
    // package's dev script directly.
    for (const def of PROCESS_DEFS) {
      expect(def.args).not.toContain("--filter");
    }
  });

  it("runs backend + frontend dev directly in their package dirs", () => {
    const byId = Object.fromEntries(PROCESS_DEFS.map((def) => [def.id, def]));

    expect(byId.backend?.command).toBe("bun");
    expect(byId.backend?.args).toEqual(["run", "dev"]);
    expect(byId.backend?.cwd).toBe("core/backend");
    expect(byId.backend?.oneShot).toBe(false);

    expect(byId.frontend?.command).toBe("bun");
    expect(byId.frontend?.args).toEqual(["run", "dev"]);
    expect(byId.frontend?.cwd).toBe("core/frontend");
    expect(byId.frontend?.oneShot).toBe(false);
  });

  it("getProcessDefs('dev') returns the default defs", () => {
    expect(getProcessDefs("dev")).toEqual(PROCESS_DEFS);
    expect(getProcessDefs()).toEqual(PROCESS_DEFS);
  });

  it("getProcessDefs('preview') serves the frontend production build", () => {
    const byId = Object.fromEntries(
      getProcessDefs("preview").map((def) => [def.id, def]),
    );
    // Frontend switches to the production-build preview script.
    expect(byId.frontend?.args).toEqual(["run", "preview:prod"]);
    expect(byId.frontend?.cwd).toBe("core/frontend");
    expect(byId.frontend?.args).not.toContain("--filter");
    // Backend and deps are unchanged from dev.
    expect(byId.backend?.args).toEqual(["run", "dev"]);
    expect(byId.deps?.command).toBe("docker");
  });

  it("runs deps as a one-shot docker task at the repo root", () => {
    const deps = PROCESS_DEFS.find((def) => def.id === "deps");
    expect(deps?.command).toBe("docker");
    expect(deps?.args).toEqual([
      "compose",
      "-f",
      "docker-compose-dev.yml",
      "up",
      "-d",
    ]);
    expect(deps?.cwd).toBeUndefined();
    expect(deps?.oneShot).toBe(true);
  });
});
