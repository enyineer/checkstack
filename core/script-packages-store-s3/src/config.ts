import { z } from "zod";

/**
 * S3-compatible blob-store configuration.
 *
 * Credentials are object-store secrets and come from the environment (the
 * standard for S3 creds) rather than the application DB - we never persist
 * `secretAccessKey` in plaintext. The admin UI persists only the
 * active-backend *selection* (`script_package_storage_config`); the
 * connection details live in env so secret material stays out of the DB.
 */
export const S3StoreConfigSchema = z.object({
  endpoint: z.string().url().optional(),
  bucket: z.string().min(1),
  region: z.string().optional(),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  /** Path-style addressing (needed by MinIO / non-AWS S3). */
  forcePathStyle: z.boolean().default(false),
});
export type S3StoreConfig = z.infer<typeof S3StoreConfigSchema>;

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === "true" || value === "1";
}

/**
 * Load + validate the S3 config from env. Returns `undefined` when the
 * backend isn't configured (no bucket / creds), so the platform falls back
 * to the postgres default. Returns a `{ error }` when partially configured
 * so the admin can see what's missing instead of silently falling back.
 */
export function loadS3ConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
):
  | { ok: true; config: S3StoreConfig }
  | { ok: false; error: string }
  | { ok: "unconfigured" } {
  const raw = {
    endpoint: env.CHECKSTACK_SCRIPT_PACKAGES_S3_ENDPOINT,
    bucket: env.CHECKSTACK_SCRIPT_PACKAGES_S3_BUCKET,
    region: env.CHECKSTACK_SCRIPT_PACKAGES_S3_REGION,
    accessKeyId: env.CHECKSTACK_SCRIPT_PACKAGES_S3_ACCESS_KEY_ID,
    secretAccessKey: env.CHECKSTACK_SCRIPT_PACKAGES_S3_SECRET_ACCESS_KEY,
    forcePathStyle: parseBool(
      env.CHECKSTACK_SCRIPT_PACKAGES_S3_FORCE_PATH_STYLE,
    ),
  };

  const anySet =
    raw.endpoint ||
    raw.bucket ||
    raw.region ||
    raw.accessKeyId ||
    raw.secretAccessKey ||
    raw.forcePathStyle !== undefined;
  if (!anySet) {
    return { ok: "unconfigured" };
  }

  const parsed = S3StoreConfigSchema.safeParse({
    ...raw,
    // Drop undefined so zod defaults / optionals apply cleanly.
    forcePathStyle: raw.forcePathStyle ?? false,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    return {
      ok: false,
      error: `S3 blob store is partially configured; invalid/missing: ${missing}`,
    };
  }
  return { ok: true, config: parsed.data };
}
