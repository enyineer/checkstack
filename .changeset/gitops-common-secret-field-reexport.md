---
"@checkstack/gitops-common": patch
---

Internal refactor: re-export the secret-name and `${{ secrets.NAME }}` template
helpers (`SECRET_NAME_REGEX`, `secretNameSchema`, `SECRET_TEMPLATE_REGEX`,
`secretTemplateSchema`, `collectSecretNames`, `SecretName`) from
`@checkstack/secrets-common`, which is now the single canonical source. No public
API or behavior change for consumers.
