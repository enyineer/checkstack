---
title: "Monitor a service across staging and production"
description: "Create two environments, attach a system to both, and configure one HTTP health check that fans out per environment using config templating."
---

This guide walks through the full environments workflow: creating environments in the catalog, attaching a system to them, and writing one HTTP health check that runs against each environment's base URL using `{{ environment.baseUrl }}` templating. You end with per-environment health values, per-environment run history, and the system rollup -- all from a single check configuration.

Read [Environments](/checkstack/user-guide/concepts/environments/) first for the mental model.

## What you need

- A Checkstack instance with the HTTP plugin installed.
- The `catalog.environments.manage` and `healthcheck.configuration.manage` access rules (both are in the built-in administrator role).

---

## 1. Create the environments

Open **Catalog management** from the sidebar, then select the **Environments** tab.

### Create a staging environment

1. Click **Add environment**.
2. Set **Name** to `staging`.
3. Under **Custom fields**, add:
   - Key: `baseUrl`, Value: `https://staging.example.com`
4. Click **Save**.

### Create a production environment

1. Click **Add environment** again.
2. Set **Name** to `production`.
3. Under **Custom fields**, add:
   - Key: `baseUrl`, Value: `https://api.example.com`
4. Click **Save**.

---

## 2. Attach the system to both environments

1. Navigate to the system you want to monitor (for example `Payments API`) in the catalog.
2. In the system editor, open the **Environments** section.
3. Select both `staging` and `production`.
4. Save the system.

The system now belongs to both environments. On the next health check run the executor reads this membership from the catalog and fans out accordingly.

> [!NOTE]
> Environment membership is many-to-many and lives only in the catalog's Postgres tables. Every pod re-reads it on every tick via the catalog RPC, so there is no pod-local membership state.

---

## 3. Create the HTTP health check with a templated URL

1. Navigate to **Health Checks** and click **Create Check**.
2. Select the **HTTP Health Check** strategy.
3. In the editor:
   - **Name**: `Payments API /healthz`
   - **Interval**: `60`

### Add the Request collector

1. Select **Add Collector** and choose **Request**.
2. In the collector's **URL** field, enter:

   ```text
   {{ environment.baseUrl }}/healthz
   ```

3. Set **Method** to `GET` and **Expected status** to `200`.
4. Leave the other fields at their defaults.

The URL field is marked `x-templatable`. At run time, before the HTTP request is made, the executor renders `{{ environment.baseUrl }}` against the resolved environment's custom fields. The result for staging is `https://staging.example.com/healthz`; for production it is `https://api.example.com/healthz`.

Templating is not limited to HTTP. Most connection and target fields across the built-in check types support `{{ … }}`, so the same "one config, many environments" pattern works for a database host, an SSH command, a DNS hostname, a gRPC host, and more. The available variables are the selected environment's custom fields (`{{ environment.<key> }}`), the check metadata (`{{ check.id }}`, `{{ check.name }}`, `{{ check.intervalSeconds }}`), and the system metadata (`{{ system.id }}`, `{{ system.name }}`).

> [!TIP]
> A field that accepts templating shows a small **Templating** badge next to its label, and typing `{{` offers autocomplete for the available variables. When a check item has templatable fields, the editor also shows a **Preview as: &lt;environment&gt;** picker next to both the connection (Strategy Configuration) heading and each check item's Configuration heading. Pick an environment and a **Preview** line appears under each templatable field, resolving the template against that environment's custom fields so you can confirm the substitution looks right before saving. The picker lists the system's environments when you opened the editor from a system, otherwise every environment.

### Assign to the system

1. In the **Systems** section of the editor, select the `Payments API` system.
2. Save the health check.

---

## 4. Configure the environment fan-out

Navigate to the system's health check assignments (**Health Checks** > select the system > **Assignments**), select the `Payments API /healthz` assignment, and open the **Execution** panel.

The **Environments** section offers three modes:

| Mode | Meaning |
|---|---|
| **All environments** | Run once per environment the system belongs to. Adding or removing the system from an environment updates the fan-out on the next tick. |
| **Specific** | Run only for the environments you select explicitly. |
| **None** | Opt out of fan-out; run exactly once with no environment context. |

Leave **All environments** selected (the default). With staging and production attached, the check now fans out to two runs per tick.

> [!NOTE]
> If the system belongs to no environment, the **Environments** section shows a "No environment configured" empty-state instead of the mode selector. Attach the system to at least one environment in the catalog (step 2) to enable per-environment fan-out. The check still runs once with no environment context until then.

> [!NOTE]
> If you later add a third environment (for example `canary`) to the system and the assignment is still in **All environments** mode, the next tick automatically picks it up with no config change.

> [!NOTE]
> When you **disable an environment on the assignment** (switch to **Specific** and deselect it, or choose **None**), that environment stops fanning out and its last health value is dropped from the system rollup and badge **immediately** - it no longer keeps the system unhealthy. Its historical per-environment slice is preserved but moves under **Old checks** in the system overview so you can still inspect it.
>
> Known limitation: under **All environments**, an environment removed only from the system's catalog membership (rather than disabled on the assignment) can still count toward the rollup badge until the assignment is re-evaluated, because the rollup is computed catalog-free so it reads the same on every server. The system overview still moves such a slice under **Old checks**.

---

## 5. Watch the per-environment results

After the first run, open the system's health check drawer:

- The runs table shows one row per environment per tick. The **Environment** column identifies which environment each row belongs to.
- Run history groups by environment so you can compare staging and production latency and failure rates independently.
- The system overview shows one row per **(check, environment)** for a fanned-out check. A row that is degraded or unhealthy shows when it was **last healthy** (for example "Healthy until 2h ago"), so you can see at a glance since when that environment has been failing without opening the drawer.

### How the fan-out is counted on the dashboard

The dashboard problem card counts **environment slices**, not checks. A single check that fans out to three environments where one environment is failing reads **"1 of 3 checks failing"**, not "1 of 1". A system with a three-environment check plus a single-environment check, with one environment failing, reads **"1 of 4 checks failing"**. An env-less check counts as one slice, so a system with no environments reads exactly as before.

### One notification per environment outage

When a fanned-out environment changes health, you get a single notification scoped to that environment (for example "... is unhealthy in environment **production**"). The system rollup ("... is unhealthy") describes the same outage, so it is **not** sent as a second, duplicate notification - the per-environment notification already tells you which environment is affected. The rollup notification is still sent for a system with no environments, and the rollup status change is still recorded and still drives automations (see section 6).

---

## 6. Read per-environment health in automations

The health triggers (`healthcheck.system_degraded`, `healthcheck.system_health_restored`, `healthcheck.system_health_changed`) fire for **both** per-environment changes and the system rollup:

- A per-environment change carries `trigger.payload.environmentId` (the environment id) and `trigger.payload.systemId`.
- The system rollup change carries only `trigger.payload.systemId` (no `environmentId`).

### Open an incident only when production is unhealthy

```yaml
trigger: healthcheck.system_degraded
filter: "trigger.payload.environmentId == 'production'"
actions:
  - openIncident:
      title: "Production degraded: {{ trigger.payload.systemId }}"
```

### Alert on any environment change (default behavior)

An automation that does not reference `environmentId` continues to fire off the system rollup, exactly as it did before environments. The rollup is the worst status across all environments, so existing automations keep working without modification.

---

## 7. Use environment values in scripts

If you are using a script collector instead of (or alongside) the HTTP collector, the resolved environment is available in two ways:

**Shell script:**

```sh
echo "checking ${CHECKSTACK_ENV_NAME} at ${CHECKSTACK_ENV_BASE_URL}"
curl -sf "${CHECKSTACK_ENV_BASE_URL}/healthz" || exit 1
```

The custom field `baseUrl` is injected as `CHECKSTACK_ENV_BASE_URL` (camelCase split to `UPPER_SNAKE_CASE`). See [Script health checks](/checkstack/user-guide/reference/script-health-checks/) for the full variable reference.

**Inline TypeScript:**

```ts
import { defineHealthCheck } from "@checkstack/healthcheck";

const baseUrl = context.environment?.fields.baseUrl ?? "http://localhost";
const resp = await fetch(`${baseUrl}/healthz`);
export default defineHealthCheck({
  success: resp.ok,
  message: `${context.environment?.name ?? "env-less"}: HTTP ${resp.status}`,
});
```

`context.environment` is `undefined` when the run has no environment (the **None** assignment mode, or **All environments** with no membership).

---

## What you built

| Component | What it does |
|---|---|
| `staging` environment | Carries `baseUrl: https://staging.example.com` |
| `production` environment | Carries `baseUrl: https://api.example.com` |
| `Payments API` system | Belongs to both environments |
| `Payments API /healthz` check | One config, runs against each environment's `baseUrl` per tick |
| Per-environment health | `payments-api::staging` and `payments-api::production` tracked independently |
| System rollup | Worst-status rollup, same id as before, picked up by existing automations |

To extend this pattern to more environments, add a new environment in the catalog, attach the system to it, and the next tick fans out automatically - no check config change needed.
