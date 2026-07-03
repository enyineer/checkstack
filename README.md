<p align="center">
  <h1 align="center">🏁 Checkstack</h1>
  <p align="center">
    <strong>Monitoring that doesn't just alert. It reacts.</strong>
  </p>
  <p align="center">
    A reactive automation engine and dependency-aware SLOs, in one self-hosted platform.
  </p>
</p>

![Checkstack Logo](assets/logo/checkstack-logo.jpg)

---

<p align="center">
  <img src="https://img.shields.io/badge/status-beta-orange?style=flat-square" alt="Beta Status" />
  <img src="https://img.shields.io/badge/runtime-bun-f9f1e1?style=flat-square&logo=bun" alt="Bun Runtime" />
  <img src="https://img.shields.io/badge/frontend-react-61dafb?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/database-postgresql-336791?style=flat-square&logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/license-ELv2-blue?style=flat-square" alt="Elastic License 2.0" />
</p>

---

> [!WARNING]
> Checkstack Core is currently in **beta**.
>
> Breaking changes might happen, but are not to be expected regularly.
>
> Some plugins are still in Alpha and need more testing, as we don't have all the integration systems available to thoroughly test them right now.
>
> Please report any issues you find via the [issue tracker](https://github.com/enyineer/checkstack/issues)!

## 📸 Screenshots

<details>
<summary><strong>🏠 Dashboard & Navigation</strong></summary>

### Dashboard
The needs-attention hub showing a system health rollup plus signal cards for SLO breaches, anomalies, and active incidents - so only systems that need you surface.
![Dashboard](assets/screenshots/dashboard.png)

### Command Palette
Lightning-fast keyboard-driven navigation with `Ctrl+K` / `Cmd+K`. Search for systems, actions, and settings instantly. Fully extensible by plugins.
![Command Palette](assets/screenshots/command-palette.png)

### Announcements
Broadcast severity-colored banners and dashboard cards to your portal users, with Markdown, scheduling, and visibility targeting.
![Announcements](assets/screenshots/announcements.png)

</details>

<details>
<summary><strong>✅ Health Checks</strong></summary>

### Strategy Picker
Browse and search all available health check strategies - HTTP, TCP, DNS, TLS, PostgreSQL, MySQL, Redis, gRPC, SSH, Ping, Script, and more. Choose a strategy to start configuring.
![Health Check Strategy Picker](assets/screenshots/healthcheck-strategies.png)

### IDE-Style Editor
Full-page editor with tree navigation, real-time validation, strategy-specific configuration, collector management, and assertion building - all in one view.
![Health Check IDE Editor](assets/screenshots/healthcheck-ide.png)

### Run History
Master-detail run history table with time-range, status, and source (region) filters, so you can isolate exactly which run failed and where it ran.
![Health Check Run History](assets/screenshots/healthcheck-run-history.png)

### Health Check Drawer
Slide-over detail with the unified chart kit: a status timeline, a latency chart with an Expected band from anomaly detection, and a recent-history ribbon.
![Health Check Detail Drawer](assets/screenshots/healthcheck-drawer.png)

### System Details with Health Status
Comprehensive system view showing SLO status, active incidents, per-environment health checks, and About metadata - all in one place.
![System Details](assets/screenshots/system-detail.png)

</details>

<details>
<summary><strong>📈 Service Level Objectives (SLO)</strong></summary>

### SLO Dashboard
SLO cards with availability percentages, error budget bars, and burn-rate multipliers across every objective at a glance.
![SLO Dashboard](assets/screenshots/slo-dashboard.png)

### SLO Details
Real-time error budget tracking with dependency-aware downtime attribution, compliance streaks, and availability trend charts.
![SLO Details](assets/screenshots/slo-detail.png)

### SLO Editor
Create and tune Service Level Objectives - target, window, and exclusion mode - in a focused management view.
![SLO Editor](assets/screenshots/slo-editor.png)

</details>

<details>
<summary><strong>🚨 Incidents & Maintenance</strong></summary>

### Incident Management
Track and document unplanned outages. Create timeline updates, link affected systems, and keep stakeholders informed in real-time.
![Incident Management](assets/screenshots/incidents.png)

### Incident Details
Rich incident timeline with status updates, affected systems, and full history. Changes are broadcast instantly via WebSocket.
![Incident Details](assets/screenshots/incident-detail.png)

### Maintenance Windows
Schedule planned maintenance with automatic status transitions from "Planned" → "Active" → "Completed". Subscribers are notified automatically.
![Maintenance Management](assets/screenshots/maintenance.png)

### Maintenance Details
Detailed maintenance view showing schedule, affected systems, and status history. Link multiple systems to a single maintenance window.
![Maintenance Details](assets/screenshots/maintenance-detail.png)

</details>

<details>
<summary><strong>📋 Catalog, Dependencies & Notifications</strong></summary>

### System Catalog
Organize your infrastructure into Systems and Groups with per-group health rollups. Track dependencies, assign owners, and maintain a clear inventory of all monitored services.
![Catalog Management](assets/screenshots/catalog-overview.png)

### Dependency Map
Interactive topology view of your system dependencies with impact-colored edges. Drag to connect systems, click edges to edit impact and propagation settings, and auto-save node positions.
![Dependency Map](assets/screenshots/dependency-map.png)

### In-App Notifications
Real-time notification feed accessible from any page. Importance-coloured cards with affected-system chips, read/unread tracking, and instant updates via WebSocket.
![In-App Notification Overview](assets/screenshots/notification-overview.png)

### Notifications Configuration
Configure multi-channel notification delivery: SMTP, Telegram, Microsoft Teams, Webex, Discord, Slack, Gotify, and Pushover. User-specific settings per channel.
![Notifications Management](assets/screenshots/notification-settings.png)

### Telegram Integration Example
Example of rich notification delivery via Telegram with formatted messages and direct links to affected systems.
![Telegram Notification](assets/screenshots/example-telegram-notification.png)

</details>

<details>
<summary><strong>🤖 AI & Automations</strong></summary>

### AI Assistant
Chat with a guardrailed operator copilot that reads platform state and proposes concrete changes for your approval, with a propose/apply flow and a full audit trail.
![AI Assistant](assets/screenshots/ai-chat.png)

### Automations
Wire triggers to ordered actions in a visual editor - open incidents, notify, or run scripts - each executing as a bounded service account.
![Automations](assets/screenshots/automations.png)

### Script Sandbox
Admin-owned security policy for scripted checks and shell actions: resource caps, rootless isolation, network egress control, seccomp, and daily vulnerability audits.
![Script Sandbox](assets/screenshots/script-sandbox.png)

</details>

<details>
<summary><strong>🔌 Automation Actions - Integrations & Queues</strong></summary>

### Integration Connections
Connect to external systems like Jira, Microsoft Teams, Webex, and custom webhooks - each becomes a first-class action you can call from any automation workflow.
![Integration Management](assets/screenshots/integrations.png)

### Queue Management
Monitor background job processing with real-time statistics. View scheduling lag, worker concurrency, and job queue status. Built-in lag warnings for health monitoring.
![Queue Management](assets/screenshots/queue-config.png)

</details>

<details>
<summary><strong>🛰️ Satellites & GitOps</strong></summary>

### Satellite Agents
Lightweight Docker agents stream health checks from any region or private network back to the core over WebSocket - same charts, same SLOs.
![Satellite Agents](assets/screenshots/satellites.png)

### GitOps Sync
Sync your monitoring stack from Git and watch reconciliation status per repository, keeping the catalog aligned with your source of truth.

### GitOps Providers
Configure GitHub and GitLab providers - including self-hosted enterprise instances - and discover definitions across repos, orgs, or wildcard patterns.

### GitOps Secrets
Reference credentials in your specs with `${{ secrets.NAME }}`, resolved from your secrets backend only in fields a plugin marks as secret.
![GitOps Secrets](assets/screenshots/gitops-secrets.png)

### GitOps Kinds
Browse the kind registry of declarable entity kinds - System, Healthcheck, SLO, Satellite, Automation, and more - available as YAML.
![GitOps Kinds](assets/screenshots/gitops-kinds.png)

</details>

<details>
<summary><strong>🔐 Authentication & Security</strong></summary>

### Roles & Access Control
Define custom roles with granular permissions, assign platform-wide access rules, and combine them with team-based resource-level access control.
![Roles and Access Control](assets/screenshots/auth-roles.png)

### Team Management
Organize users into logical teams for resource-level access control. Designate team managers and assign API keys to teams for automated workflows.
![Team Management](assets/screenshots/auth-teams.png)

### Authentication Strategies
Configure multiple authentication methods: Credential Login, GitHub OAuth, SAML 2.0 SSO, and LDAP/AD. Includes directory group-to-role mapping for enterprise SSO.
![Authentication Strategies](assets/screenshots/auth-strategies.png)

### External Applications
Create API keys (service accounts) for machine-to-machine access. Full RBAC permission control and optional team assignment for scoped access.
![External Applications](assets/screenshots/auth-applications.png)

### Profile Management
Users can update their profile information including name and email (for credential users). Credential users can also change their password from this page.
![Profile Management](assets/screenshots/profile.png)

</details>

<details>
<summary><strong>📖 API Documentation</strong></summary>

### Built-in API Docs
Interactive API documentation. Explore all available endpoints and view response schemas directly in the browser.
![API Documentation](assets/screenshots/api-docs.png)

</details>

---

## ✨ What is Checkstack?

**Checkstack** is a self-hosted, source-available monitoring and status page platform. It watches your services with automated health checks, but it doesn't stop at firing an alert. Two capabilities set it apart:

- A **reactive automation engine** that turns health, incident, and SLO events into ordered workflows with real control flow - so a flapping system can open an incident, page on-call, file a Jira ticket, and auto-resolve on recovery without a human in the loop.
- **Dependency-aware SLOs** that know *why* a system was down and stop burning your error budget for an upstream's outage.

On top of that you get a system catalog with a dependency map and per-system **environments**, incident and maintenance management, multi-channel notifications, a public status page, GitOps, satellite agents, a guardrailed **AI assistant**, and a plugin architecture you can extend end to end. It runs as N horizontally-scaled pods over one PostgreSQL database.

## 🚀 Why Checkstack

Two pillars make Checkstack different from an uptime checker that only sends alerts.

### ⚡ Reactive automation engine
> *Wire any event to an ordered workflow - no polling, no glue scripts*

Operators wire **triggers** to ordered **actions** with full control flow (`choose`, `parallel`, `repeat`, `delay`, `wait_for_trigger`, `wait_until`, `stop`). The engine is fully reactive: domain state changes drive triggers and wake waiting runs through a durable work-queue pipeline rather than a polling loop, and every suspend survives a process restart.

- **Reactive, event-driven triggers** - health, incident, maintenance, dependency, and SLO state changes fire automations directly. No cron sweep over your fleet.
- **Per-trigger filters and dwells** - gate on a bare expression (`trigger.payload.systemId == "payments-api"`), and require the state to hold with a `for:` dwell ("degraded for 30 minutes").
- **General windowed-count / rate triggers** - the `window:` rate gate fires only after a trigger has matched `count` times within a trailing `minutes`, scoped per partition key. Flapping is just this gate over health-change events ("3 unhealthy transitions in 60 minutes, per system") - one automation covers every system, no per-check policy to keep in sync.
- **Conditions** - pre-run gates and mid-run guards: combinators (`and` / `or` / `not`), `numeric_state`, `time` (quiet hours / on-call), and `state` (held-for-duration).
- **Actions for everything** - open / resolve incidents, schedule maintenance, send notifications, and call **integrations** (Jira, Microsoft Teams, Webex, generic webhook) as first-class actions. Reach for **Run Script (TypeScript)** to run arbitrary logic in a sandboxed Bun subprocess, with access to an admin-curated npm allowlist.
- **Author it your way** - build automations in the visual editor or as YAML; the two round-trip losslessly, and the whole definition can live in Git (`kind: Automation`).

**Example - auto-incident on flapping, then auto-resolve:**

```yaml
triggers:
  - event: healthcheck.system_health_changed
    filter: 'trigger.payload.newStatus != "healthy"'  # count unhealthy transitions
    window: { count: 3, minutes: 60, refire: once }   # 3 in 60 min, per system
conditions:
  - "!health.system.in_maintenance"
actions:
  - action: incident.create
    config:
      severity: critical
      systemIds: ["{{ trigger.payload.systemId }}"]
      dedupe_open_for_system: true   # reuse the system's open incident
```

### 📈 Dependency-aware SLOs
> *Stop burning your error budget for someone else's outage*

Most SLO tools treat every minute of downtime the same. Checkstack's SLO engine knows *why* your system was down - and whether it was your fault.

- **Dependency-aware attribution** - when an upstream dependency fails, that downtime is attributed to the upstream system instead of burning your error budget.
- **Real-time event splitting** - if an upstream goes down mid-outage, the timeline is split: self-caused minutes before, upstream-attributed minutes after, recorded to the second as it happens.
- **Configurable exclusion modes** - choose `strict` (all downtime counts) or `self-only` (upstream failures excluded) per SLO.
- **Burn-rate alerts** - configurable warning / critical thresholds that emit events you can react to in an automation.
- **Compliance streaks and achievements** - track consecutive days meeting target, with gamified milestones and an automated weekly digest.
- **Multiple SLOs per system** - run a strict 30-day SLO alongside a lenient 90-day upstream-overlap SLO on the same system.

**Example:** a checkout service depends on a payments API. When payments goes down, checkout's `self-only` SLO keeps its error budget intact and attributes the minutes upstream - so a burn-rate page fires for payments, not for the team that did nothing wrong.

## 🧰 Supporting features

Everything you need around the two pillars.

### 🤖 AI assistant
> *Ask, propose, apply - a built-in operator copilot that respects your guardrails*

A first-class AI assistant grounded in your platform and your docs. Connect any OpenAI-compatible provider (OpenAI, OpenRouter, DeepSeek, or self-hosted) and chat in a streaming console that can read platform state and propose concrete changes for your approval.

- **Propose / apply with diffs** - the assistant proposes mutating changes (full CRUD for health checks and automations, plus incident / maintenance / catalog tools) as GitHub-style split diffs with word-level highlighting; nothing is applied without approval, with a per-conversation **approve** vs **auto** permission mode.
- **Grounded and capability-aware** - answers are grounded in the bundled documentation (`searchDocs` / `getDoc`) and a live capability catalog; it can dry-run a script in the sandbox (`testScript`) and probe a URL (SSRF-guarded) before recommending a check.
- **Safe by construction** - every tool call runs as *you* (your access rules), is audited and replayable, with enforced secret scrubbing, a model allowlist, and a per-integration spend cap.
- **Automations can use it too** - an **AI automation action** runs a bounded agent inside a workflow, reading platform state through read-only projected tools to summarize, triage, or decide.
- **Plugin-owned and open** - every plugin contributes its own AI tools and read projections, and the platform exposes a read-only **MCP server** (OAuth, introspect-time scope narrowing) for external agents.

---

### 🧭 Operator console
> *See what needs attention, and get there fast*

- **Needs-attention dashboard** - the home dashboard surfaces only systems that need you (degraded, unhealthy, breaching an SLO, under an incident or maintenance, anomalous, or with a dependency problem), sorted by severity, each row deep-linking to the source - healthy systems stay out of the way. Plugins contribute new signal types through an extension slot, so the overview is open-ended.
- **Left sidebar navigation** - grouped, access-filtered navigation across the whole platform; the user menu is now account-only.
- **Redesigned catalog** - a group-first browse view with inline health rollups and a tabbed management surface (multi-select bulk actions, keyboard drag-and-drop, accessibility).
- **In-app user guide** - the full documentation is served inside the app (works in air-gapped installs), linked right from the sidebar.

---

### Health Checks
> *Know when things break - before your users do*

Multi-strategy probes with pluggable **collectors** and flexible **assertions** (response time, status, content, numeric comparisons). Historical data flows through a multi-tier storage pipeline (raw -> hourly -> daily) for trend analysis, and the architecture is pluggable so you can add a strategy for any protocol.

**Built-in Check Types:**

| Category | Provider | Description |
|----------|----------|-------------|
| **Network** | HTTP/HTTPS | Endpoint monitoring with status codes, headers, body assertions |
| | Ping (ICMP) | Network reachability with packet loss and latency tracking |
| | TCP | Port connectivity with banner reading support |
| | DNS | Record resolution (A, AAAA, CNAME, MX, TXT, NS) |
| | TLS/SSL | Certificate expiry, chain validation, issuer verification |
| **Database** | PostgreSQL | Connection testing, custom queries, row count assertions |
| | MySQL | Connection testing, custom queries, row count assertions |
| | Redis | PING latency, server role detection, version checking |
| **Protocol** | gRPC | Standard Health Checking Protocol (grpc.health.v1) |
| | RCON | Game server monitoring (Minecraft, CS:GO/CS2) with player counts |
| **Scripted** | SSH | Remote command execution with exit code validation |
| | Script | Local command/script execution with output parsing |

---

### Satellite Agents
> *Monitor from everywhere - not just your data center*

A service reachable from your server might be unreachable from your customers. Satellite agents are lightweight containers that execute health checks from remote locations and report results back to the core platform.

**How it works:**

```
┌─────────────┐     WebSocket      ┌──────────────┐
│  Satellite  │◄──────────────────►│  Core Server │
│  (eu-west)  │  auth + heartbeat  │              │
│             │───────────────────►│  Ingestion   │
│  Executes   │  result payloads   │  Pipeline    │
│  HTTP/DNS/  │                    │              │
│  TCP checks │  ◄────────────────│  Config Push │
└─────────────┘  live assignments  └──────────────┘
```

**Features:**
- 🌍 **Multi-Location Monitoring** - Deploy satellites in any region to test reachability from your users' perspective
- 🔄 **Live Configuration Push** - Assign health checks to satellites in the UI and they receive updates instantly via WebSocket
- 🏷️ **Source Attribution** - Every run is tagged with its origin (Local vs. satellite name + region)
- 🔍 **Source Filtering** - Filter charts and history by source to isolate results from a specific satellite or local execution
- 📊 **Unified Aggregation** - Satellite results flow through the same aggregation pipeline (raw -> hourly -> daily)
- 🐳 **Single Container** - Each satellite is a lean Alpine-based Docker image with no database required

---

### System Catalog & Dependencies
> *Your single source of truth, and how it all connects*

Organize infrastructure into **Systems** and **Groups** with owners and a clear inventory. Define directional dependencies ("A depends on B"), classify each as informational, degraded, or critical, and enable multi-hop propagation so warnings cascade through the chain (with cycle detection). An interactive **dependency map** lets you drag-to-connect, edit edges, and auto-save positions - and the same graph feeds dependency-aware SLO attribution.

---

### Environments
> *One system, many environments - monitored and templated per environment*

Model **environments** (e.g. `production`, `staging`, `eu-west`) as an instance-wide, many-to-many catalog primitive with custom fields. Health checks run **per environment** with full result fan-out, and any templatable config field can reference the resolved environment context.

- **Per-environment runs** - the same check definition runs against each assigned environment, with results dimensioned by environment and rolled up into the system's overall health.
- **Config templating** - template URLs, hosts, headers, and script inputs against environment fields, with a **live preview-as-environment** in the health-check and catalog editors.
- **GitOps + RBAC** - environments are declarable as code and gated on `environment.manage`.

---

### Incident Management
> *Handle the unexpected with clarity*

- **Incident Tracking** - Document unplanned outages with status updates
- **Timeline Updates** - Keep stakeholders informed as situations evolve
- **Affected Systems** - Link incidents to impacted services
- **Realtime Updates** - Changes broadcast instantly via WebSocket

---

### Maintenance Windows
> *Communicate planned work proactively*

- **Scheduled Maintenance** - Plan ahead with start/end times
- **Automatic Transitions** - Status changes from "Planned" → "Active" → "Completed"
- **Multi-System Impact** - Associate maintenance with multiple affected services
- **User Notifications** - Alert subscribers before and during maintenance

---

### Announcements
> *Broadcast important messages to your portal users*

- **Global Banners** - Display severity-colored notification strips above the navbar on every page
- **Dashboard Cards** - Show announcements as expandable cards in the dashboard overview
- **Markdown Support** - Rich text formatting for announcement messages
- **Visibility Control** - Target all visitors or only authenticated users
- **Scheduling** - Configure start and expiry dates for time-limited announcements
- **Dismissal Persistence** - Users can dismiss banners (stored server-side for logged-in users)
- **Realtime Updates** - Announcements appear/disappear instantly for all connected users via WebSocket
- **Command Palette** - Quick access via `⇧⌘A` / `Ctrl+Shift+A`

---

### Multi-Channel Notifications
> *Reach people where they are*

| Channel | Description |
|---------|-------------|
| 📧 **SMTP** | Email notifications with templated content |
| 💬 **Telegram** | Instant messaging with rich formatting |
| 💼 **Microsoft Teams** | Personal chat messages via Microsoft Graph API |
| 🌐 **Webex** | Direct messages through Cisco Webex |
| 🎮 **Discord** | Webhook notifications with rich embeds |
| 💬 **Slack** | Incoming webhooks with Block Kit formatting |
| 🔔 **Gotify** | Self-hosted push notifications |
| 📱 **Pushover** | Mobile push notifications with priority levels |
| 🔔 **In-App** | Realtime notification center with read/unread tracking |

Subscribe users to systems and automatically notify them on status changes.

---

### Integrations as automation actions
> *Connect to your existing ecosystem - from inside an automation*

Integrations are not a separate event-router you configure once. Each integration plugin contributes **actions** you compose inside an automation, so the same workflow that opens an incident can also file a Jira ticket and post to a channel, with full control flow and conditions around it.

| Integration | Actions |
|-------------|---------|
| 🎫 **Jira** | Create an issue, transition it, add a comment |
| 💼 **Microsoft Teams** | Post a message or an Adaptive Card to a channel |
| 🌐 **Webex** | Post a message to a Webex space |
| 🔗 **Webhook** | POST the rendered payload to any HTTP endpoint |
| ⚙️ **Run Script** | Execute TypeScript / shell in a sandboxed Bun subprocess |

Artifacts produced by one action (a Jira issue key, an incident id) flow to later actions in the run - so a `wait_for_trigger` for the resolved event can transition the same Jira issue closed.

---

### Run Script & script packages
> *Drop into TypeScript when the building blocks aren't enough - safely*

The **Run Script (TypeScript)** automation action runs an async module in an OS-level **sandboxed** Bun subprocess with a typed `context` (the trigger payload is a discriminated union over the automation's subscribed triggers). Scripts - both automation actions and inline health-check collectors - can `import` from a global, admin-curated **npm allowlist**: packages are pinned to exact versions, bundled by the central server, and distributed to every core instance and satellite so a script runs the same everywhere.

- **Sandboxed by default (fail-closed)** - script and shell health checks and the `run_script` / `run_shell` actions execute inside an OS-level sandbox that is **on by default**: resource caps, privilege drop, an environment denylist, filesystem isolation, per-run fork-bomb containment, a validated seccomp profile, controlled network egress (with a rootless egress path), and an OOM output guard. A single global policy is admin-configurable and relayed to satellites (fail-closed until relayed).
- **Scheduled vulnerability auditing** - installed script packages are audited on a schedule (`bun audit`); advisories surface in the UI and can drive notifications.

---

### Secrets backends
> *Keep credentials out of your definitions*

Reference secrets from automations, health checks, and GitOps specs without embedding them. Checkstack ships a built-in **local** backend (AES-GCM encrypted at rest) and a read-through **HashiCorp Vault** backend (token, AppRole, or OIDC auth). Resolved values are masked from run logs by a per-run, least-privilege mask set that is re-seeded when a suspended run resumes on a different pod.

---

### Public REST API
> *Integrate programmatically with your infrastructure*

Checkstack exposes a comprehensive REST API that enables external systems to interact with the platform programmatically via **API keys** (service accounts):

| Use Case | Description |
|----------|-------------|
| 🚨 **Monitoring Alerts** | Prometheus, Grafana, or PagerDuty can create/resolve incidents automatically |
| 🚀 **CI/CD Pipelines** | Schedule maintenance windows during deployments |
| 🏗️ **Infrastructure as Code** | Terraform, Pulumi, or Ansible can manage systems and groups |
| ⚙️ **Deployment Scripts** | Configure health checks as part of service provisioning |
| 🔗 **Custom Integrations** | Any external tool can interact via authenticated API calls |

**Example: Create an incident from an external alerting system**
```bash
curl -X POST https://checkstack.local/api/incident/createIncident \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<appId>_<secret>" \
  -d '{"title": "High CPU Alert", "status": "investigating", "systemIds": ["..."]}'
```

API keys are managed via **Settings → External Applications** with full RBAC permission control.

---

### GitOps Integration
> *Manage your infrastructure as code with automated synchronization*

Connect Checkstack directly to your source control repositories and declare your infrastructure as YAML. The built-in entity kinds cover **System**, **Healthcheck**, **SLO**, **Satellite**, and **Automation** - so an entire reactive workflow can live in Git, not just your catalog.

- **Provider Support** - Native integrations with GitHub and GitLab, including self-hosted enterprise instances
- **Automated Discovery** - Dynamically discover definitions across individual repositories, whole organizations, or wildcard patterns
- **Resource Provenance** - Resources synchronized via GitOps are automatically locked from manual editing in the UI to prevent configuration drift
- **Reconciliation Engine** - Robust lifecycle management that creates, updates, and removes resources as your code changes
- **Background Synchronization** - Automatic recurring sync jobs keep your Checkstack catalog perfectly aligned with your source of truth
- **Secret References** - Inject credentials with `${{ secrets.NAME }}` template syntax, resolved from your secrets backend only in fields a plugin marks as secret

---

### Flexible Authentication & Access Control
> *Secure access with enterprise-grade granularity*

**Authentication Methods:**
- **Credential Login** - Built-in username/password with secure password reset
- **GitHub OAuth** - Single sign-on with GitHub
- **SAML 2.0** - Enterprise SSO with identity providers (Okta, Azure AD, OneLogin, etc.)
- **LDAP/AD** - Enterprise directory integration with Active Directory
- **API Tokens** - Service accounts for machine-to-machine access

**Directory Group-to-Role Mapping:**
- Automatically assign Checkstack roles based on directory group memberships
- Configure mappings in SAML/LDAP strategy settings with dynamic role dropdowns
- Additive sync: directory roles are added without removing manually-assigned roles
- Optional default role for all users from a specific directory

**Role-Based Access Control (RBAC):**
- Define custom roles with specific permissions
- Assign roles to users for platform-wide access rules
- Preconfigured roles for common use cases (Admin, Viewer, etc.)

**Resource-Level Access Control (RLAC):**
- Grant teams fine-grained access to individual resources
- Configure read-only or full management permissions per resource
- Enable "Team Only" mode to restrict resources exclusively to team members

**Team Management:**
- Organize users into logical teams (e.g., "Platform Team", "API Developers")
- Designate **Team Managers** who can manage membership and settings
- Assign **External Applications** (API keys) to teams for automated workflows

---

### Plugin Architecture
> *Extend everything*

Checkstack is built from the ground up as a **modular plugin system**:

- 🧩 **Backend Plugins** - Add new APIs, services, database schemas
- 🎨 **Frontend Plugins** - Extend UI with new pages, components, themes
- ⚡ **Automation Extensions** - Contribute triggers, actions, and artifact types; make domain state reactive with `defineEntity`
- 📡 **Notification Strategies** - Deliver alerts through new channels
- ✅ **Health Check Strategies & Collectors** - Monitor services in custom ways
- 🗂️ **GitOps Kinds & Secrets Backends** - Register declarative entity kinds and credential stores
- 📦 **Typed SDK** - script and plugin authors import a versioned, codegen-driven `@checkstack/sdk` (per-domain subpath exports); the in-app editor injects matching types for the running version
- 🚀 **Standalone scaffolder** - `create-checkstack-plugin` scaffolds an external plugin outside the monorepo - it serves its API and runs its migrations on first boot

Every piece of state is designed for horizontal scale: Checkstack runs as **N pods sharing one PostgreSQL database**, so reads return the same answer on every pod and suspended automation runs survive a restart on any pod.

## 🖥️ Technology Stack

| Layer | Technologies |
|-------|--------------|
| **Runtime** | [Bun](https://bun.sh) |
| **Backend** | [Hono](https://hono.dev), [Drizzle ORM](https://orm.drizzle.team), [PostgreSQL](https://postgresql.org) |
| **Frontend** | [React](https://react.dev), [Vite](https://vitejs.dev), [TailwindCSS](https://tailwindcss.com), [ShadCN/UI](https://ui.shadcn.com) |
| **Validation** | [Zod](https://zod.dev) |
| **Realtime** | WebSocket (native Bun) |
| **Queue** | BullMQ (Redis) / In-Memory |

## 📚 Documentation

Full documentation - installation, configuration, operator guides, plugin development, and API reference - lives on the docs site:

**👉 [enyineer.github.io/checkstack](https://enyineer.github.io/checkstack/)**

The docs are split into two tracks:

- **User Guide** - for operators running Checkstack (install, configure, monitor)
- **Developer Guide** - for engineers building plugins or contributing to the platform

## 🤝 Contributing

We welcome contributions! See our [Contributing Guide](./CONTRIBUTING.md) for:

- Development environment setup
- Code style guidelines
- Testing requirements
- Pull request process

## 📄 License

This project is licensed under the [**Elastic License 2.0**](LICENSE.md).

| Allowed | Not Allowed |
|---------|-------------|
| ✅ Internal company use | ❌ Selling as managed SaaS |
| ✅ Personal projects | ❌ Removing license protections |
| ✅ Research & education | |
| ✅ Modification & redistribution | |
| ✅ Building applications on top | |

**Need a commercial license to provide Checkstack as a managed / SaaS service?** [Contact us](mailto:hi@enking.dev)

---

<p align="center">
  <sub>Built with ❤️ for reliability engineers everywhere</sub>
</p>