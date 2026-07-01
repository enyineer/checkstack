import { describe, expect, it } from "bun:test";
import { buildPreviewProcessDefs } from "./process-defs.ts";

describe("buildPreviewProcessDefs", () => {
  const defs = buildPreviewProcessDefs({
    backendPort: 41234,
    vitePort: 45678,
    previewDatabaseUrl: "postgres://c:c@localhost:5432/checkstack_preview",
    namespace: "preview",
  });
  const byId = Object.fromEntries(defs.map((d) => [d.id, d]));

  it("points the backend at its own port, the preview db, and the namespace", () => {
    expect(byId.backend?.env?.PORT).toBe("41234");
    expect(byId.backend?.env?.DATABASE_URL).toBe(
      "postgres://c:c@localhost:5432/checkstack_preview",
    );
    expect(byId.backend?.env?.CHECKSTACK_INSTANCE_NAMESPACE).toBe("preview");
    // BASE_URL is the preview vite origin so the SPA is same-origin.
    expect(byId.backend?.env?.BASE_URL).toBe("http://localhost:45678");
    expect(byId.backend?.cwd).toBe("core/backend");
  });

  it("serves the frontend on a strict random port proxying the preview backend", () => {
    expect(byId.frontend?.args).toEqual([
      "x",
      "vite",
      "--port",
      "45678",
      "--strictPort",
    ]);
    expect(byId.frontend?.env?.CHECKSTACK_DEV_BACKEND_URL).toBe(
      "http://localhost:41234",
    );
    expect(byId.frontend?.cwd).toBe("core/frontend");
  });

  it("marks both as long-running", () => {
    expect(byId.backend?.oneShot).toBe(false);
    expect(byId.frontend?.oneShot).toBe(false);
  });
});
