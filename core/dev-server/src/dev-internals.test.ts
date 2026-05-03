import { describe, it, expect } from "bun:test";
import path from "node:path";
import {
  parseDevArgs,
  validatePluginPackageJson,
  resolveBackendEntry,
  shouldSpawnFrontend,
  buildBackendChildEnv,
  createDebouncedWatcher,
  type TimerHandle,
} from "./dev-internals";

// ─────────────────────────────────────────────────────────────────────
// parseDevArgs
// ─────────────────────────────────────────────────────────────────────

describe("parseDevArgs", () => {
  it("uses sensible defaults when no flags or env are set", () => {
    const args = parseDevArgs({ raw: [], env: {}, cwd: "/some/where" });
    expect(args).toEqual({
      cwd: "/some/where",
      port: 3000,
      frontendPort: 5173,
      databaseUrl:
        "postgresql://checkstack:checkstack@localhost:5432/checkstack",
      watch: true,
      showHelp: false,
    });
  });

  it("reads PORT, FRONTEND_PORT, DATABASE_URL from env when present", () => {
    const args = parseDevArgs({
      raw: [],
      env: {
        PORT: "4001",
        FRONTEND_PORT: "5500",
        DATABASE_URL: "postgresql://other:host/db",
      },
      cwd: "/x",
    });
    expect(args.port).toBe(4001);
    expect(args.frontendPort).toBe(5500);
    expect(args.databaseUrl).toBe("postgresql://other:host/db");
  });

  it("CLI flags override env defaults", () => {
    const args = parseDevArgs({
      raw: [
        "--port",
        "4002",
        "--frontend-port",
        "5174",
        "--db-url",
        "postgres://override",
      ],
      env: {
        PORT: "4001",
        FRONTEND_PORT: "5500",
        DATABASE_URL: "postgresql://other:host/db",
      },
      cwd: "/x",
    });
    expect(args.port).toBe(4002);
    expect(args.frontendPort).toBe(5174);
    expect(args.databaseUrl).toBe("postgres://override");
  });

  it("--cwd resolves relative paths against process.cwd()", () => {
    const args = parseDevArgs({
      raw: ["--cwd", "./plugin"],
      env: {},
      cwd: "/initial",
    });
    // path.resolve uses real cwd; just verify --cwd flag was honored
    expect(path.isAbsolute(args.cwd)).toBe(true);
    expect(args.cwd.endsWith("/plugin")).toBe(true);
  });

  it("--no-watch disables watching", () => {
    const args = parseDevArgs({ raw: ["--no-watch"], env: {}, cwd: "/x" });
    expect(args.watch).toBe(false);
  });

  it("--help and -h both flip showHelp", () => {
    expect(
      parseDevArgs({ raw: ["--help"], env: {}, cwd: "/x" }).showHelp,
    ).toBe(true);
    expect(parseDevArgs({ raw: ["-h"], env: {}, cwd: "/x" }).showHelp).toBe(
      true,
    );
  });

  it("ignores unknown flags rather than throwing", () => {
    const args = parseDevArgs({
      raw: ["--unknown", "--port", "9000"],
      env: {},
      cwd: "/x",
    });
    expect(args.port).toBe(9000);
  });
});

// ─────────────────────────────────────────────────────────────────────
// validatePluginPackageJson
// ─────────────────────────────────────────────────────────────────────

describe("validatePluginPackageJson", () => {
  const validPkg = {
    name: "@my-org/widget-backend",
    version: "1.0.0",
    description: "Test plugin",
    author: "Tester",
    license: "Elastic-2.0",
    checkstack: { type: "backend", pluginId: "widget" },
  };

  it("returns ok with parsed metadata for a valid package.json", () => {
    const result = validatePluginPackageJson({
      cwd: "/cwd",
      readFile: () => JSON.stringify(validPkg),
      exists: () => true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metadata.name).toBe("@my-org/widget-backend");
      expect(result.metadata.checkstack.pluginId).toBe("widget");
    }
  });

  it("returns missingPackageJson when no package.json on disk", () => {
    const result = validatePluginPackageJson({
      cwd: "/cwd",
      readFile: () => {
        throw new Error("should not be called");
      },
      exists: () => false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect("missingPackageJson" in result).toBe(true);
    }
  });

  it("returns issues with field paths when validation fails", () => {
    // Strip required fields
    const broken = { ...validPkg, description: "", license: "" };
    const result = validatePluginPackageJson({
      cwd: "/cwd",
      readFile: () => JSON.stringify(broken),
      exists: () => true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "issues" in result) {
      const all = result.issues.join("\n");
      expect(all).toContain("description");
      expect(all).toContain("license");
    }
  });

  it("issues field paths are dot-joined and not empty", () => {
    const missingCheckstack = {
      ...validPkg,
      checkstack: { type: "backend" }, // pluginId missing → wait, pluginId is optional
    };
    // Force a real failure: invalid type
    const trulyBroken = {
      ...validPkg,
      checkstack: { type: "invalid-type" },
    };
    void missingCheckstack;
    const result = validatePluginPackageJson({
      cwd: "/cwd",
      readFile: () => JSON.stringify(trulyBroken),
      exists: () => true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && "issues" in result) {
      expect(result.issues.length).toBeGreaterThan(0);
      for (const issue of result.issues) {
        expect(issue.includes(":")).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// resolveBackendEntry
// ─────────────────────────────────────────────────────────────────────

describe("resolveBackendEntry", () => {
  it("resolves to <pkgDir>/<main> when @checkstack/backend is installed", () => {
    const pkgJsonPath = "/cwd/node_modules/@checkstack/backend/package.json";
    const entry = resolveBackendEntry({
      fromCwd: "/cwd",
      resolveFrom: (_, req) =>
        req === "@checkstack/backend/package.json" ? pkgJsonPath : undefined,
      readFile: () =>
        JSON.stringify({
          name: "@checkstack/backend",
          main: "src/index.ts",
        }),
    });
    expect(entry).toBe("/cwd/node_modules/@checkstack/backend/src/index.ts");
  });

  it("falls back to src/index.ts when no main field", () => {
    const entry = resolveBackendEntry({
      fromCwd: "/cwd",
      resolveFrom: () => "/x/package.json",
      readFile: () => JSON.stringify({ name: "@checkstack/backend" }),
    });
    expect(entry).toBe("/x/src/index.ts");
  });

  it("returns undefined when @checkstack/backend isn't installed", () => {
    const entry = resolveBackendEntry({
      fromCwd: "/cwd",
      resolveFrom: () => undefined,
    });
    expect(entry).toBeUndefined();
  });

  it("returns undefined when package.json fails to parse", () => {
    const entry = resolveBackendEntry({
      fromCwd: "/cwd",
      resolveFrom: () => "/x/package.json",
      readFile: () => "not-json",
    });
    expect(entry).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// shouldSpawnFrontend
// ─────────────────────────────────────────────────────────────────────

describe("shouldSpawnFrontend", () => {
  it("returns true for a frontend-type plugin", () => {
    expect(
      shouldSpawnFrontend({ checkstack: { type: "frontend" } } as never),
    ).toBe(true);
  });

  it("returns true for a backend bundle primary that lists a -frontend sibling", () => {
    expect(
      shouldSpawnFrontend({
        checkstack: {
          type: "backend",
          bundle: ["@my-org/widget-common", "@my-org/widget-frontend"],
        },
      } as never),
    ).toBe(true);
  });

  it("returns false for a backend plugin with no bundle", () => {
    expect(
      shouldSpawnFrontend({ checkstack: { type: "backend" } } as never),
    ).toBe(false);
  });

  it("returns false for a backend bundle primary with only -common siblings", () => {
    expect(
      shouldSpawnFrontend({
        checkstack: {
          type: "backend",
          bundle: ["@my-org/widget-common"],
        },
      } as never),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildBackendChildEnv
// ─────────────────────────────────────────────────────────────────────

describe("buildBackendChildEnv", () => {
  const args = {
    cwd: "/plugin/cwd",
    port: 4001,
    frontendPort: 5174,
    databaseUrl: "postgresql://x:y@localhost/z",
    watch: true,
    showHelp: false,
  };

  it("sets the three dev-mode env vars and primary HTTP config", () => {
    const env = buildBackendChildEnv({
      args,
      parentEnv: {},
      extraPluginPaths: ["/a/path", "/b/path"],
    });
    expect(env.CHECKSTACK_DEV_PLUGIN_PATH).toBe("/plugin/cwd");
    expect(env.CHECKSTACK_DEV_AUTH).toBe("true");
    expect(env.CHECKSTACK_DEV_EXTRA_PLUGIN_PATHS).toBe(
      JSON.stringify(["/a/path", "/b/path"]),
    );
    expect(env.PORT).toBe("4001");
    expect(env.DATABASE_URL).toBe("postgresql://x:y@localhost/z");
    expect(env.BASE_URL).toBe("http://localhost:4001");
    expect(env.AUTH_SECRET).toBe("checkstack-dev-secret");
    expect(env.NODE_ENV).toBe("development");
  });

  it("inherits parent env (e.g. PATH) without dropping it", () => {
    const env = buildBackendChildEnv({
      args,
      parentEnv: { PATH: "/usr/bin:/bin", HOME: "/home/test" },
      extraPluginPaths: [],
    });
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/home/test");
  });

  it("respects parent BASE_URL / AUTH_SECRET / NODE_ENV when set", () => {
    const env = buildBackendChildEnv({
      args,
      parentEnv: {
        BASE_URL: "http://custom.local",
        AUTH_SECRET: "user-secret",
        NODE_ENV: "test",
      },
      extraPluginPaths: [],
    });
    expect(env.BASE_URL).toBe("http://custom.local");
    expect(env.AUTH_SECRET).toBe("user-secret");
    expect(env.NODE_ENV).toBe("test");
  });

  it("CHECKSTACK_DEV_EXTRA_PLUGIN_PATHS is valid JSON for an empty list", () => {
    const env = buildBackendChildEnv({
      args,
      parentEnv: {},
      extraPluginPaths: [],
    });
    const parsed = JSON.parse(env.CHECKSTACK_DEV_EXTRA_PLUGIN_PATHS as string);
    expect(parsed).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// createDebouncedWatcher
// ─────────────────────────────────────────────────────────────────────

describe("createDebouncedWatcher", () => {
  /**
   * Tiny synthetic timer harness. Lets us drive setTimeout callbacks
   * synchronously inside tests without `await new Promise(setTimeout)`
   * games. Each scheduled callback gets a numeric handle; `tick()`
   * fires every callback whose deadline has passed.
   */
  function makeFakeClock() {
    interface ScheduledTimer {
      handle: number;
      fireAt: number;
      fn: () => void;
    }
    const scheduled = new Map<number, ScheduledTimer>();
    let now = 0;
    let nextHandle = 1;
    return {
      setTimer: (fn: () => void, ms: number): TimerHandle => {
        const handle = nextHandle++;
        scheduled.set(handle, { handle, fireAt: now + ms, fn });
        return handle;
      },
      clearTimer: (h: TimerHandle) => {
        scheduled.delete(h as number);
      },
      advance: (ms: number) => {
        now += ms;
        const due = [...scheduled.values()]
          .filter((t) => t.fireAt <= now)
          .toSorted((a, b) => a.fireAt - b.fireAt);
        for (const t of due) {
          scheduled.delete(t.handle);
          t.fn();
        }
      },
      pendingCount: () => scheduled.size,
    };
  }

  it("calls onTrigger once after the debounce window for a single feed", () => {
    let triggers = 0;
    const clock = makeFakeClock();
    const w = createDebouncedWatcher({
      onTrigger: () => triggers++,
      delayMs: 150,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    w.feed("index.ts");
    expect(triggers).toBe(0);
    expect(clock.pendingCount()).toBe(1);
    clock.advance(150);
    expect(triggers).toBe(1);
    expect(clock.pendingCount()).toBe(0);
  });

  it("coalesces a burst of feeds into one trigger", () => {
    let triggers = 0;
    const clock = makeFakeClock();
    const w = createDebouncedWatcher({
      onTrigger: () => triggers++,
      delayMs: 150,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    // Burst: 5 events well within the debounce window
    w.feed("a.ts");
    clock.advance(20);
    w.feed("b.ts");
    clock.advance(20);
    w.feed("c.ts");
    clock.advance(20);
    w.feed("d.ts");
    clock.advance(20);
    w.feed("e.ts");
    expect(triggers).toBe(0);
    // Each feed cancelled the previous timer; only the last is pending
    expect(clock.pendingCount()).toBe(1);

    // Now let the window elapse from the last feed
    clock.advance(150);
    expect(triggers).toBe(1);
  });

  it("two well-separated feeds trigger twice", () => {
    let triggers = 0;
    const clock = makeFakeClock();
    const w = createDebouncedWatcher({
      onTrigger: () => triggers++,
      delayMs: 150,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    w.feed("a.ts");
    clock.advance(150);
    expect(triggers).toBe(1);
    w.feed("b.ts");
    clock.advance(150);
    expect(triggers).toBe(2);
  });

  it("ignores undefined filenames", () => {
    let triggers = 0;
    const clock = makeFakeClock();
    const w = createDebouncedWatcher({
      onTrigger: () => triggers++,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    w.feed(undefined);
    expect(clock.pendingCount()).toBe(0);
  });

  it("ignores tilde-suffixed editor swap files", () => {
    let triggers = 0;
    const clock = makeFakeClock();
    const w = createDebouncedWatcher({
      onTrigger: () => triggers++,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    w.feed("index.ts~");
    expect(clock.pendingCount()).toBe(0);
    clock.advance(1000);
    expect(triggers).toBe(0);
  });

  it("ignores dotfiles", () => {
    let triggers = 0;
    const clock = makeFakeClock();
    const w = createDebouncedWatcher({
      onTrigger: () => triggers++,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    w.feed(".#index.ts");
    expect(clock.pendingCount()).toBe(0);
    clock.advance(1000);
    expect(triggers).toBe(0);
  });

  it("dotfile in the middle of a burst does not break the debounce of real edits", () => {
    let triggers = 0;
    const clock = makeFakeClock();
    const w = createDebouncedWatcher({
      onTrigger: () => triggers++,
      delayMs: 150,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    w.feed("a.ts");
    clock.advance(50);
    w.feed(".swp");
    clock.advance(50);
    w.feed("b.ts");
    clock.advance(150);
    expect(triggers).toBe(1);
  });
});
