import { existsSync } from "node:fs";
import path from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { bootBackend } from "./boot.ts";
import { captureAll } from "./capture/capture.ts";
import { convertPngsToWebp } from "./capture/webp.ts";
import { OUT_DIR, REPO_ROOT } from "./config.ts";
import { seed } from "./seed/index.ts";

/**
 * End-to-end screenshot pipeline:
 *   ephemeral Postgres -> boot backend (auto-migrates) -> seed demo world ->
 *   drive Chromium over every curated screen -> tear everything down.
 *
 * The database is a throwaway Testcontainers Postgres, fully isolated from the
 * developer's working database; shared redis is namespaced by the backend. The
 * only artifact left behind is the staged PNGs under `.screenshots/out/`.
 */

// Ryuk (the Testcontainers reaper) keeps a socket open that Bun does not
// `unref`, hanging teardown; we stop the container deterministically instead.
process.env.TESTCONTAINERS_RYUK_DISABLED = "true";

async function ensureFrontendBuilt(): Promise<void> {
  // ALWAYS rebuild by default: a stale `core/frontend/dist` is the classic way
  // to shoot yesterday's UI. Reuse the existing build only when explicitly
  // opted in (SHOTS_SKIP_BUILD=1) for fast local iteration.
  const dist = path.join(REPO_ROOT, "core", "frontend", "dist", "index.html");
  if (process.env.SHOTS_SKIP_BUILD === "1" && existsSync(dist)) {
    console.log("Reusing existing frontend build (SHOTS_SKIP_BUILD=1).");
    return;
  }
  console.log("Building frontend fresh (this is the current UI)...");
  const build = Bun.spawn({
    cmd: ["bun", "run", "--filter", "@checkstack/frontend", "build"],
    cwd: REPO_ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await build.exited;
  if (code !== 0) throw new Error(`Frontend build failed (exit ${code})`);
}

async function main(): Promise<void> {
  await ensureFrontendBuilt();

  console.log("Starting ephemeral Postgres...");
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withUsername("checkstack")
    .withPassword("checkstack")
    .withDatabase("checkstack")
    .start();
  const databaseUrl = container.getConnectionUri();

  let backend: Awaited<ReturnType<typeof bootBackend>> | undefined;
  try {
    console.log("Booting backend + running migrations...");
    backend = await bootBackend({ databaseUrl });

    console.log("Seeding demo world...");
    const refs = await seed({ databaseUrl });

    console.log("Capturing screenshots...");
    const { captured, failed } = await captureAll({ refs });

    console.log("Converting to WEBP (marketing) alongside PNG (README)...");
    const { converted } = await convertPngsToWebp();

    console.log(
      `\nDone: ${captured.length} captured (${converted} webp), ${failed.length} failed -> ${OUT_DIR}`,
    );
    if (failed.length > 0) console.log(`Failed: ${failed.join(", ")}`);
  } finally {
    await backend?.stop();
    console.log("Stopping ephemeral Postgres...");
    await container.stop({ timeout: 0 });
  }
}

await main();
