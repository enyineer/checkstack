---
title: GitOps
description: Express your catalog and health checks as YAML in a Git repository. Checkstack reconciles the live state to match the files on each sync.
---

GitOps in Checkstack lets you express the things you would otherwise click through the UI (systems, groups, health checks, satellites, SLOs, ...) as YAML files in a Git repository. Checkstack reads the repo on a schedule (or on demand), parses every descriptor, and reconciles the live database to match. Changes flow through pull requests; the platform reflects what is in `main`.

## The promise

Run your monitoring as code. Specifically:

- **Pull requests for catalog changes.** Adding a new system, changing a health check interval, or renaming a group becomes a diff in version control.
- **Reproducible environments.** Spin up a fresh Checkstack instance, point it at the same repo, and the catalog rebuilds itself.
- **Audit trail by default.** Git history is the audit log for every change, complete with author and review.
- **No hand-clicking for repetitive work.** Generate descriptors from a template if you have hundreds of similar systems.

You can mix GitOps-managed and UI-managed resources in the same instance. Anything not declared in YAML stays exactly as you left it in the UI.

## The shape of a descriptor

Every YAML descriptor uses a Kubernetes-style envelope:

```yaml
apiVersion: checkstack.io/v1alpha1
kind: System
metadata:
  name: payment-api           # url-safe id, lowercase + hyphens
  title: Payment API          # optional display name
  description: Public API for taking payments
  labels:                     # optional key/value filters
    team: payments
  tags:                       # optional string tags
    - tier-1
spec:
  # fields defined by the kind. The System kind has no REQUIRED spec, but
  # accepts optional spec.fields (free-form custom fields surfaced to
  # templating as {{ system.metadata.<key> }}), and plugins can extend it
  # (healthcheck assignments, dependencies, ...)
```

You write one descriptor per resource. They can live in one big file, in per-resource files, in per-team subdirectories, whatever shape your repo prefers. The reconciler walks every YAML file it finds.

## Which kinds are supported

The built-in kinds at the time of writing:

| Kind | Owner plugin | What it declares |
|------|---------------|------------------|
| `System` | catalog | A catalog system, plus extended healthcheck and dependency fields. |
| `Group` | catalog | A catalog group and its membership. |
| `Healthcheck` | healthcheck | A health-check configuration. |
| `SLO` | slo | A service-level objective. |
| `Satellite` | satellite | A registered satellite agent. |
| `View` | catalog | A saved catalog view configuration. |

Plugins can register additional kinds (or extend the built-in ones). For the full YAML schema of every kind, including extension fields and examples, see [GitOps kind reference](/checkstack/user-guide/reference/gitops-kinds/).

## Workflow

The typical loop:

```text
   +-----------------+            +---------------------+
   |  Edit YAML in   |  git push  |   Your Git repo     |
   |  your repo      | ---------> |   (main branch)     |
   +-----------------+            +---------------------+
                                            |
                                            v
                              +-----------------------------+
                              |  Checkstack provider polls  |
                              |  (or webhook triggers sync) |
                              +-----------------------------+
                                            |
                                            v
                              +-----------------------------+
                              |   parse + validate every    |
                              |   descriptor (envelope +    |
                              |   spec schema)              |
                              +-----------------------------+
                                            |
                                            v
                              +-----------------------------+
                              |  topo-sort by entity refs   |
                              |  reconcile in dependency    |
                              |  order                      |
                              +-----------------------------+
                                            |
                                            v
                              +-----------------------------+
                              |  live state now matches     |
                              |  the file tree              |
                              +-----------------------------+
```

Deletions work the same way: removing a descriptor from the repo flags the corresponding live resource for cleanup on the next sync.

> [!IMPORTANT]
> Only resources Checkstack created from a GitOps sync are managed by GitOps. Removing a YAML file does not delete a hand-created resource with the same name. The reconciler tracks provenance per resource.

## Secrets

Sensitive values do not live in YAML. Use the `${{ secrets.NAME }}` template syntax to reference a secret stored in Checkstack's secret store:

```yaml
spec:
  config:
    password: "${{ secrets.payment-db-password }}"
    connectionString: "postgres://user:${{ secrets.DB_PASS }}@host/db"
```

The reconciler resolves these only in fields the registering plugin marked as secret. That means a secret reference accidentally placed in `metadata.title` will not get expanded and leak. When you rotate a secret, every entity referencing it is flagged for re-reconciliation on the next sync.

Secrets are managed centrally in **Settings -> Secrets** (the platform-wide secret store), and the same `${{ secrets.NAME }}` references work everywhere, not just in GitOps. By default they are encrypted at rest with your `ENCRYPTION_MASTER_KEY`; an external backend (HashiCorp Vault) can be selected instead. See the [Secrets platform](/checkstack/developer-guide/backend/secrets/) reference for the full model.

## Providers

A **provider** is the source of the YAML files. Checkstack ships with GitHub and GitLab providers; the same code path handles `github.com` and self-hosted GitHub Enterprise, and `gitlab.com` and self-hosted GitLab. Each provider configuration carries:

- The repository URL.
- An access token or app credentials.
- The branch to track.
- The directory path to scan.
- The sync frequency.

Multiple providers can coexist in one Checkstack instance; you can have a Payments team repo and a Platform team repo each reconciled independently.

## Entity references

Use Kubernetes-style structured references to link descriptors together:

```yaml
spec:
  healthcheck:
    - ref:
        kind: Healthcheck
        name: payment-db-check
```

The reconciler builds a dependency graph from these refs and visits descriptors in topological order, so by the time `payment-api` is reconciled, `payment-db-check` already exists.

## UI vs YAML in practice

A few honest trade-offs:

- **First-pass setup is faster in the UI.** Click through, get the shape right, and you have something running.
- **Steady-state management is faster in YAML.** Bulk renames, recurring patterns, and reviewing changes is much nicer through pull requests.
- **Drift is real.** If someone edits a system in the UI that is GitOps-managed, the next sync will overwrite the UI edit. Decide which resources are GitOps-managed and stick to that.

> [!TIP]
> A reasonable hybrid: declare systems, groups, and health checks in YAML. Leave incidents, maintenances, and team membership in the UI. The former are "long-lived configuration"; the latter are "operational reality" that change too often for git review.

## UI tour

| Where to go | What you do there |
|-------------|-------------------|
| **Infrastructure -> GitOps -> Providers** | Connect a Git repo, set the branch and path. |
| **Settings -> Secrets** | Manage the secrets that `${{ secrets.NAME }}` references resolve to (platform-wide). |
| **Infrastructure -> GitOps -> Entities** | See which resources are GitOps-managed and their last sync status. |
| **Sync now** button | Trigger an immediate reconciliation outside the schedule. |

## Where to go next

- **Hands-on.** Walk through [GitOps quickstart](/checkstack/user-guide/guides/gitops-quickstart/).
- **YAML schema.** See [GitOps kind reference](/checkstack/user-guide/reference/gitops-kinds/) for every field of every kind.
- **Custom kinds.** Plugin authors can register their own kinds; see [GitOps entity kinds](/checkstack/developer-guide/backend/gitops/entity-kinds/).
