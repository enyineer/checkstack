/**
 * Secret-name + `${{ secrets.NAME }}` template helpers.
 *
 * The canonical definitions live in `@checkstack/secrets-common` (the secrets
 * platform owns this concern). This module re-exports them so existing
 * `@checkstack/gitops-common` consumers keep their import paths unchanged and
 * there is a single source of truth (no drift between two copies).
 */
export {
  SECRET_NAME_REGEX,
  secretNameSchema,
  SECRET_TEMPLATE_REGEX,
  secretTemplateSchema,
  collectSecretNames,
  type SecretName,
} from "@checkstack/secrets-common";
