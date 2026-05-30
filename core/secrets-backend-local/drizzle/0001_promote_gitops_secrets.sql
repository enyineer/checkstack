-- Promote existing GitOps secrets into the central local secret backend.
--
-- The legacy GitOps `secrets` table lives in the `plugin_gitops` Postgres
-- schema (see getPluginSchemaName). This copies its rows into this
-- backend's `secrets` table WITHOUT loss: it is guarded by to_regclass so a
-- fresh install (no gitops table) is a no-op, and ON CONFLICT (name) keeps
-- any already-present row. The source table is intentionally NOT dropped —
-- gitops switches to reading via the secretResolverRef, and leaving its
-- table in place means no rows can be lost if plugin migration order ever
-- runs gitops after this one.
DO $$
BEGIN
  IF to_regclass('"plugin_gitops".secrets') IS NOT NULL THEN
    INSERT INTO secrets (id, name, encrypted_value, description, created_by, created_at, updated_at)
    SELECT id, name, encrypted_value, description, created_by, created_at, updated_at
    FROM "plugin_gitops".secrets
    ON CONFLICT (name) DO NOTHING;
  END IF;
END
$$;
