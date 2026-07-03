import path from "node:path";

/**
 * Shared configuration for the screenshot pipeline: the repo layout, the
 * throwaway backend origin, the admin identity we onboard, the capture
 * viewport, and where the generated images land.
 *
 * Everything the pipeline needs is derived here so the orchestrator, seeder,
 * and capturer agree on ports, paths, and identity without threading config
 * through every call.
 */

/** Repo root, resolved from this file (core/screenshots/src -> repo root). */
export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");

/** Port the throwaway backend listens on (kept clear of dev :3000 / e2e :3100). */
export const BACKEND_PORT = Number(process.env.CHECKSTACK_SHOTS_PORT ?? 3200);

/** Origin the backend serves the built SPA + REST API from. */
export const BASE_URL = `http://localhost:${BACKEND_PORT}`;

/** REST surface the `@checkstack/sdk` OpenAPILink talks to. */
export const REST_URL = `${BASE_URL}/rest`;

/** better-auth base path (see core/auth-backend betterAuth basePath). */
export const AUTH_BASE = `${BASE_URL}/api/auth`;

/** The named admin we onboard, shown in the navbar avatar and profile shots. */
export const ADMIN = {
  name: "Alex Rivera",
  email: "alex@acme.dev",
  // Must satisfy the platform passwordSchema (length + character classes).
  password: "Checkstack-Demo-2026",
} as const;

/**
 * Capture viewport. A large desktop at deviceScaleFactor 2 yields crisp,
 * retina marketing images. Height is a floor; full-page shots grow past it.
 */
export const VIEWPORT = { width: 1600, height: 1000 } as const;
export const DEVICE_SCALE_FACTOR = 2;

/** localStorage key the @checkstack/ui ThemeProvider reads (values: dark|light). */
export const THEME_STORAGE_KEY = "checkstack-ui-theme";

/** localStorage key the @checkstack/ui PerformanceProvider reads ("true"|"false"). */
export const LOW_POWER_STORAGE_KEY = "checkstack-low-power";

/** Absolute output directory for generated images (staging; user copies out). */
export const OUT_DIR = path.join(REPO_ROOT, ".screenshots", "out");
