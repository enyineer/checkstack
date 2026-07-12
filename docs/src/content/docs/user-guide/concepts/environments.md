---
title: Environments
description: Environments are instance-wide sets of custom fields that any system can belong to many-to-many, so you can describe where a system runs without duplicating it.
---

An **environment** describes *where* a system runs: production, staging, a region, a tenant. It is an instance-wide catalog primitive (a sibling of groups) that carries a free-form set of **custom fields** and attaches to any number of systems many-to-many. Environments let you capture per-environment details (a base URL, a region, a tier) in one place instead of cloning systems or checks.

## What an environment is

Every environment has:

- A **name** (required) and an optional **description**.
- A free-form set of **custom fields**: key/value pairs such as `baseUrl`, `region`, or `tier`. The values are stored verbatim, so you can put anything in them that helps describe the environment.

Environments are global to the instance. You define an environment once, then attach it to as many systems as belong to it.

## Many-to-many with systems

A system can belong to **many** environments, and an environment can contain **many** systems. For example, a `payments-api` system might belong to both `production` and `staging`, while a `production` environment groups every system that runs in production.

Membership is independent of [groups](/checkstack/user-guide/concepts/systems-and-groups/): groups roll up health by team or domain, while environments describe deployment context and carry custom fields.

## Custom fields

Custom fields are free-form in this release: any key, any string-ish value. There is no declared schema, so you can add `baseUrl`, `region`, `tier`, or whatever your checks and dashboards need. Two reserved names, `id` and `name`, are projected from the environment's own columns rather than from custom fields.

## Managing environments

You can manage environments from the catalog config page, or declaratively with [GitOps](/checkstack/user-guide/concepts/gitops/).

In the UI, open **Catalog management**, use the **Environments** panel to create, edit, and delete environments and their custom fields, and set which environments a system belongs to from the **Systems** tab (the per-row environment chips) or by attaching systems from the **Environments** panel.

With GitOps, declare an environment with the `Environment` kind and attach systems with the `System.environments` extension:

```yaml
apiVersion: checkstack.io/v1alpha1
kind: Environment
metadata:
  name: production
  title: Production
  description: Live production traffic
spec:
  fields:
    baseUrl: https://api.example.com
    region: eu-west-1
    tier: "1"
---
apiVersion: checkstack.io/v1alpha1
kind: System
metadata: { name: payment-api }
spec:
  environments:
    - { kind: Environment, name: production }
```

See the [GitOps kinds reference](/checkstack/user-guide/reference/gitops-kinds/) for the full `Environment` kind and `System.environments` extension.

## Per-environment fan-out

When a health check is assigned to a system, it **fans out into one run per environment**. Each run executes independently and is stored with its own `environmentId`, so per-environment results, status history, and aggregates stay distinct instead of collapsing into a single number. Each run also exposes that environment's custom fields to script collectors via `CHECKSTACK_ENV_*` and `globalThis.context.environment` (see [script health checks](/checkstack/user-guide/reference/script-health-checks/)).

You choose which environments a check fans out across **per assignment**. On a system's health-check assignment, the **Execution** panel offers three modes:

- **All environments** (the default): run once for every environment the system currently belongs to. Adding or removing the system from an environment changes the fan-out automatically on the next run.
- **Specific**: run only for the environments you pick. An explicitly selected environment that the system no longer belongs to is silently skipped.
- **None**: opt out of fan-out. The check runs exactly **once with no environment** in context.

A check whose effective environment set is empty (the **None** mode, or **All environments** when the system has no environments) runs exactly once with no environment, which is identical to how checks ran before environments existed.

### Run identity

A run is identified by `(system, configuration, environment)`. Run history groups by environment, and an env-less run is shown as **None**.

## Per-environment health

Health is reactive **per environment**. Each environment a system runs in has its own health value computed from only that environment's runs, alongside a **system rollup** that aggregates across every environment.

- The **per-environment health** of `<system>` in `<environment>` reflects only that environment's runs. So `payments-api` can be unhealthy in `production` while healthy in `staging`, and each is tracked, alerted, and charted on its own.
- The **system rollup** is the worst status across all of the system's environments (and any env-less runs): degraded if any environment is degraded, unhealthy if any is unhealthy, healthy only when all are healthy. This is the same system-level value dashboards, status badges, and existing automations have always read, so nothing you built before environments needs re-authoring. It keeps working and now reflects every environment.

You do not configure this split. It follows automatically from the per-environment fan-out: a system with no environments has exactly one health value (the rollup, identical to before), and a system with environments gains a per-environment value for each plus the rollup.

### Health automations and `environmentId`

The health triggers (`System Health Degraded`, `System Health Restored`, `System Health Changed`) fire for **both** the per-environment changes and the system rollup change:

- An automation that scopes on the system (reading `trigger.payload.systemId`, or partitioning by system) keeps firing off the rollup exactly as before. The rollup payload carries the bare `systemId` and **no** `environmentId`.
- A per-environment change additionally carries the optional `trigger.payload.environmentId`. Filter on it to react to a specific environment, for example "open an incident only when `production` is unhealthy":

```yaml
trigger: healthcheck.system_degraded
filter: "trigger.payload.environmentId == 'production'"
```

An automation that does not reference `environmentId` is unaffected by the new per-environment events because the rollup change still fires for it.

## Publishing environments on a status page

A [status page](/checkstack/developer-guide/architecture/status-pages/) can be scoped to publish only some environments. In the status page builder, the **Published environments** picker in the page settings selects which environments the page reflects. Leave it empty to publish **all** environments (the default, and how every existing page behaves).

When you select one or more environments, the page omits everything for systems that belong to **none** of the selected environments:

- **Status and uptime**: a system's status rolls up from only its selected-environment runs, and its uptime counts only runs recorded in those environments. A system in both `production` and `staging`, on a production-only page, shows its production health and uptime, not a cross-environment mix.
- **Incidents and maintenance**: an incident or maintenance window appears only when at least one of its affected systems belongs to a selected environment. Systems outside the selected environments are not listed on the item, even when the same incident also affects them.
- **Email subscriptions**: the per-system subscribe picker and the outbound fan-out both honor the same scope, so subscribers are never emailed about a system the page does not show.

> [!NOTE]
> Incidents and maintenance windows carry no environment of their own - they are scoped **indirectly** through their affected systems. A system that belongs to several environments therefore makes its incidents visible on a page publishing **any** of those environments. If `payments-api` is in both `production` and `staging`, an incident on it appears on a production-only page and on a staging-only page alike (the multi-environment caveat).

Incident-forced status overrides are whole-system rather than per-environment, so on an environment-scoped page they are surfaced through the (env-filtered) incidents feed rather than folded into the per-environment health rollup.

## Templating config with `{{ environment.* }}`

An environment's custom fields are available in **collector config templating**, so one check configuration covers every environment without duplication. The motivating case is the HTTP collector's URL: store it once as `{{ environment.baseUrl }}/healthz` and each per-environment run resolves it against that environment's `baseUrl`.

Templating is **opt-in per field**. A field is only rendered when the collector marks it templatable; every other field is passed through verbatim, so a literal `{{` in a non-templatable field is never touched. On the built-in HTTP collector, the **URL**, each **header value**, and the **request body** are templatable.

The values you can reference are:

- `{{ environment.<key> }}` - the resolved environment's custom fields for this run, for example `{{ environment.baseUrl }}` or `{{ environment.region }}`.
- `{{ check.id }}`, `{{ check.name }}`, `{{ check.intervalSeconds }}` - the running check.
- `{{ system.id }}`, `{{ system.name }}` - the system being checked.
- `{{ system.metadata.<key> }}` - the system's own custom fields, for example `{{ system.metadata.baseUrl }}`. These are namespaced under `.metadata` so a custom field can never shadow `{{ system.name }}` or `{{ system.id }}`. Use environment fields for values that differ per deployment stage, and system fields for values intrinsic to the system itself.

For example, an HTTP check whose URL is:

```text
{{ environment.baseUrl }}/healthz
```

runs against `https://prod.example.com/healthz` in `production` and `https://staging.example.com/healthz` in `staging`, from a single configuration. The config editor shows a **Preview** line under each templatable field so you can see the resolved value while editing.

> [!NOTE]
> When a check runs with **no** environment (the **None** assignment mode, or **All environments** with no membership), every `{{ environment.* }}` reference renders to an empty string. For the HTTP URL this produces an invalid URL, and the run fails with a clear "Rendered URL is invalid" config error rather than silently passing.

### Script collectors - `CHECKSTACK_ENV_*` and `context.environment`

Script collectors receive the resolved environment through two surfaces that mirror the config-templating context:

**Shell scripts** get one injected variable per custom field, normalized to `UPPER_SNAKE_CASE`:

```sh
# baseUrl -> CHECKSTACK_ENV_BASE_URL
curl -sf "${CHECKSTACK_ENV_BASE_URL}/healthz" || exit 1
echo "environment: ${CHECKSTACK_ENV_NAME} (id: ${CHECKSTACK_ENV_ID})"
```

**Inline TypeScript/JavaScript** scripts read `globalThis.context.environment`:

```ts
import { defineHealthCheck } from "@checkstack/healthcheck";

const baseUrl = context.environment?.fields.baseUrl ?? "http://localhost";
export default defineHealthCheck({
  success: true,
  message: `${context.environment?.name ?? "no env"} at ${baseUrl}`,
});
```

`context.environment` is `undefined` when the run has no environment. `CHECKSTACK_ENV_*` variables are not injected for an env-less run. Full variable reference is in [Script health checks](/checkstack/user-guide/reference/script-health-checks/).

### Templating and secrets

Config templating (`{{ ... }}`) and [secret references](/checkstack/user-guide/reference/secret-encryption/) (`${{ secrets.NAME }}`) are deliberately distinct and never overlap:

- The two syntaxes differ by the leading `$`: `${{ secrets.NAME }}` is a secret reference, `{{ environment.baseUrl }}` is a template reference.
- They are resolved in separate, ordered stages: **secrets first, templating second**. A resolved secret value that happens to contain `{{` is therefore never re-interpreted as a template.
- A single field can be **either** a secret field **or** a templatable field, never both. Combining the two markers on one field is rejected when the plugin loads.

So secrets stay in secret fields (resolved by the secrets engine) and environment values stay in templatable fields (resolved by the template engine), with no interference between them.
