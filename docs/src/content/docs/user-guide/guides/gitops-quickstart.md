---
title: "GitOps quickstart"
description: "Connect Checkstack to a Git repository, push a YAML descriptor for a system, and watch the reconciler create it from the file."
---

GitOps lets you manage Checkstack resources as YAML files in a Git repository. Push a file, the reconciler picks it up on the next sync cycle, and the corresponding entity (system, health check, satellite, SLO, ...) appears or updates in Checkstack. Delete the file, the reconciler removes the entity (or orphans it, depending on policy).

This walkthrough connects Checkstack to a repo, adds a `kind: System` YAML descriptor, and confirms the reconciler created the system. For the full kind reference (every built-in kind, every extension, every field), see [GitOps kind reference](/checkstack/user-guide/reference/gitops-kinds/).

## 1. Pick or create a Git repository

You need a Git repository the Checkstack core server can reach over HTTPS. GitHub, GitLab, GitHub Enterprise, and self-hosted GitLab all work.

For this walkthrough, create a new repo (or reuse an existing one) and clone it locally. The reconciler scans repos using a glob; the default pattern is `.checkstack/**/*.yaml`, so create that directory:

```bash
mkdir -p .checkstack
```

## 2. Mint an auth token

The reconciler reads the repo with a personal access token (or a fine-grained scoped token):

- **GitHub** - create a personal access token with `repo` scope (or a fine-grained token with `Contents: Read` on the target repo).
- **GitLab** - create a project access token with `read_repository` scope.

Copy the token. You will paste it into Checkstack in step 4.

> [!IMPORTANT]
> Treat the token as a secret. Anyone with it can read your repo. Checkstack stores it encrypted at rest using the platform's `ENCRYPTION_MASTER_KEY`.

## 3. Open the GitOps page in Checkstack

Sign in as a user with the `gitops.providers.manage` access rule (included in the administrator role). From the user menu, open **GitOps**.

The page has three tabs:

- **Providers** - Git repositories Checkstack syncs from.
- **Secrets** - opaque values referenced by `${{ secrets.NAME }}` in your YAML.
- **Sync Status** - per-entity reconcile log and any errors.

Stay on the **Providers** tab.

## 4. Register the provider

1. Click **Add Provider**.
2. Fill in the dialog:
   - **Provider Type** - `GitHub` or `GitLab`.
   - **Target** - either `org` (for an org-wide scan) or `owner/repo` (for a single repository). For the walkthrough, use `owner/repo`, for example `acme/checkstack-gitops`.
   - **Path Pattern** - leave the default `.checkstack/**/*.yaml`.
   - **Base URL** - leave empty for github.com or gitlab.com; set it to your enterprise instance's API URL otherwise.
   - **Auth Token** - paste the token you minted in step 2.
   - **Sync Interval** - how often the reconciler polls for changes. `300` (5 minutes) is a sensible default.
   - **Deletion Policy** - `orphan` keeps the entity in Checkstack if its YAML file is deleted (safe default). `auto` deletes it.
3. Click **Save**.

Checkstack immediately attempts a first sync. The provider row updates with a green "synced" indicator if the auth and pattern check out, or a red error indicator with the failure reason otherwise.

## 5. Author a System descriptor

In your local clone, create `.checkstack/payments-api.yaml`:

```yaml
apiVersion: checkstack.io/v1alpha1
kind: System
metadata:
  name: payments-api
  title: Payments API
  description: Production payments and refunds.
  labels:
    team: platform
  tags:
    - production
spec: {}
```

The descriptor envelope follows the Kubernetes-inspired shape every kind shares:

- `apiVersion: checkstack.io/v1alpha1` - required, must match a registered kind.
- `kind: System` - the entity kind.
- `metadata.name` - lowercase, hyphenated, URL-safe. This is the stable identifier.
- `metadata.title` - optional, the human-readable display name.
- `spec` - kind-specific configuration. The base System kind has no spec fields, but extensions (`spec.healthcheck`, `spec.dependencies`, ...) attach here.

For the full schema of every built-in kind, see [GitOps kind reference](/checkstack/user-guide/reference/gitops-kinds/).

## 6. Push the descriptor

```bash
git add .checkstack/payments-api.yaml
git commit -m "Add payments-api system"
git push origin main
```

## 7. Watch the reconcile log

Back in Checkstack, open the **Sync Status** tab on the GitOps page. Wait for the next sync cycle (up to the sync interval you configured in step 4) - or click **Sync now** on the provider row to force one.

After the sync, the log shows a new entry for `payments-api`:

- **Kind** - `System`.
- **Name** - `payments-api`.
- **Provenance** - the file path and commit SHA the entity was reconciled from.
- **Status** - `applied` if the reconcile succeeded.

Open the **Catalog** page. The `Payments API` system appears in the list, with a small GitOps badge next to its name indicating it is managed declaratively.

## 8. Try an update

Change the description in the YAML:

```yaml
metadata:
  name: payments-api
  title: Payments API
  description: Production payments, refunds, and chargebacks.
```

Commit and push. After the next sync, the system's description is updated. The catalog UI disables the description field on the system editor because the entity is GitOps-managed - the YAML is the source of truth.

## 9. Use a secret

For sensitive values (database passwords, satellite tokens that you mint locally, integration credentials), use the `${{ secrets.NAME }}` template:

1. Open the **Secrets** tab on the GitOps page and click **Add Secret**.
2. Fill in:
   - **Name** - for example `payment-db-password`.
   - **Value** - the actual secret. Stored encrypted at rest.
3. Reference it in your YAML:
   ```yaml
   apiVersion: checkstack.io/v1alpha1
   kind: Healthcheck
   metadata:
     name: payment-db-check
   spec:
     strategy: postgres
     intervalSeconds: 60
     config:
       host: db.internal
       port: 5432
       database: payments
       user: monitor
       password: "${{ secrets.payment-db-password }}"
   ```

Secrets are only resolved in fields the registering plugin marks as secret in its config schema. They never leak through display fields like `metadata.title`.

## 10. Clean up

To remove a GitOps-managed entity:

- **With deletion policy `auto`** - delete the YAML file from the repo. The next sync removes the entity.
- **With deletion policy `orphan`** (the default) - delete the YAML file. The entity stays in Checkstack but loses its GitOps badge; you can edit or delete it through the UI from then on.

## See also

- [GitOps kind reference](/checkstack/user-guide/reference/gitops-kinds/) - every built-in kind, every extension, every field.
- [GitOps entity kinds (developer)](/checkstack/developer-guide/backend/gitops/entity-kinds/) - registering your own kinds and extensions as a plugin author.
- [Connect a satellite](/checkstack/user-guide/guides/connect-a-satellite/) - the manual flow that the `kind: Satellite` descriptor replaces.
