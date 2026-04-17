<p align="center">
  <h1 align="center">🏁 Checkstack</h1>
  <p align="center">
    <strong>The Modern Status Page & Monitoring Platform</strong>
  </p>
  <p align="center">
    Monitor your systems. Keep users informed. Maintain trust.
  </p>
</p>

![Checkstack Logo](assets/logo/checkstack-logo.jpg)

---

<p align="center">
  <img src="https://img.shields.io/badge/status-alpha-orange?style=flat-square" alt="Alpha Status" />
  <img src="https://img.shields.io/badge/runtime-bun-f9f1e1?style=flat-square&logo=bun" alt="Bun Runtime" />
  <img src="https://img.shields.io/badge/frontend-react-61dafb?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/database-postgresql-336791?style=flat-square&logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/license-ELv2-blue?style=flat-square" alt="Elastic License 2.0" />
</p>

---

> [!WARNING]
> Checkstack is currently in **alpha** and is not ready for production use.
>
> Breaking changes are to be expected regularly in this development phase. We're still happy if you try it out and give us feedback!

## 📸 Screenshots

<details>
<summary><strong>🏠 Dashboard & Navigation</strong></summary>

### Dashboard
The central hub showing all your systems with real-time health status badges, recent activity feed, and quick access to key functions.
![Dashboard](assets/screenshots/dashboard.png)

### Command Palette
Lightning-fast keyboard-driven navigation with `Ctrl+K` / `Cmd+K`. Search for systems, actions, and settings instantly. Fully extensible by plugins.
![Command Palette](assets/screenshots/command-palette.png)

</details>

<details>
<summary><strong>✅ Health Checks</strong></summary>

### Health Check Configuration
Configure automated monitoring with strategy-specific settings. Supports HTTP, TCP, DNS, TLS, PostgreSQL, MySQL, Redis, gRPC, RCON, SSH, and custom scripts.
![Health Check Configuration](assets/screenshots/healthcheck-config.png)

### Flexible Assertions
Define custom success criteria with multiple assertion types: status codes, response times, content matching, numeric comparisons, and more.
![Health Check Assertions](assets/screenshots/healthcheck-config-assertion.png)

### System Details with Health Status
Comprehensive system view showing current health status, historical performance charts with response times, and detailed check results.
![System Details](assets/screenshots/system-details.png)

</details>

<details>
<summary><strong>🚨 Incidents & Maintenance</strong></summary>

### Incident Management
Track and document unplanned outages. Create timeline updates, link affected systems, and keep stakeholders informed in real-time.
![Incident Management](assets/screenshots/incident-management.png)

### Incident Details
Rich incident timeline with status updates, affected systems, and full history. Changes are broadcast instantly via WebSocket.
![Incident Details](assets/screenshots/incident-details.png)

### Maintenance Windows
Schedule planned maintenance with automatic status transitions from "Planned" → "Active" → "Completed". Subscribers are notified automatically.
![Maintenance Management](assets/screenshots/maintenance-management.png)

### Maintenance Details
Detailed maintenance view showing schedule, affected systems, and status history. Link multiple systems to a single maintenance window.
![Maintenance Details](assets/screenshots/maintenance-details.png)

</details>

<details>
<summary><strong>📋 Catalog & Notifications</strong></summary>

### System Catalog
Organize your infrastructure into Systems and Groups. Track dependencies, assign owners, and maintain a clear inventory of all monitored services.
![Catalog Management](assets/screenshots/catalog-management.png)

### In-App Notification Bell
Real-time notification center accessible from any page. Shows unread count badge and instant updates via WebSocket.
![In-App Notification Bell](assets/screenshots/in-app-notification-bell.png)

### In-App Notification Overview
Full notification history with read/unread tracking. Mark individual notifications or all as read with a single click.
![In-App Notification Overview](assets/screenshots/in-app-notification-overview.png)

### Notifications Configuration
Configure multi-channel notification delivery: SMTP, Telegram, Microsoft Teams, Webex, Discord, Slack, Gotify, and Pushover. User-specific settings per channel.
![Notifications Management](assets/screenshots/notifications-management.png)

### Telegram Integration Example
Example of rich notification delivery via Telegram with formatted messages and direct links to affected systems.
![Telegram Notification](assets/screenshots/example-telegram-notification.png)

</details>

<details>
<summary><strong>🔌 Integrations & Queues</strong></summary>

### External Integrations
Connect Checkstack to external systems like Jira, Microsoft Teams, Webex, and custom webhooks. Event-driven architecture enables automated workflows.
![Integration Management](assets/screenshots/integration-management.png)

### Queue Management
Monitor background job processing with real-time statistics. View scheduling lag, worker concurrency, and job queue status. Built-in lag warnings for health monitoring.
![Queue Management](assets/screenshots/queue-management.png)

</details>

<details>
<summary><strong>🔐 Authentication & Security</strong></summary>

### User & Role Management
Manage users with flexible role assignments. Support for both local accounts and external identity provider users (SAML, LDAP, GitHub OAuth).
![User Role Management](assets/screenshots/user-role-management.png)

### Role-Based Access Control
Define custom roles with granular permissions. Assign platform-wide access rules and combine with team-based resource-level access control.
![Role Access Management](assets/screenshots/role-access-management.png)

### Team Management
Organize users into logical teams for resource-level access control. Designate team managers and assign API keys to teams for automated workflows.
![Team Management](assets/screenshots/team-management.png)

### Authentication Strategies
Configure multiple authentication methods: Credential Login, GitHub OAuth, SAML 2.0 SSO, and LDAP/AD. Includes directory group-to-role mapping for enterprise SSO.
![Authentication Strategies](assets/screenshots/auth-strategies.png)

### External Applications
Create API keys (service accounts) for machine-to-machine access. Full RBAC permission control and optional team assignment for scoped access.
![External Applications](assets/screenshots/applications.png)

### Profile Management
Users can update their profile information including name and email (for credential users). Credential users can also change their password from this page.
![Profile Management](assets/screenshots/profile-management.png)

</details>

<details>
<summary><strong>📖 API Documentation</strong></summary>

### Built-in API Docs
Interactive API documentation. Explore all available endpoints and view response schemas directly in the browser.
![API Documentation](assets/screenshots/api-docs.png)

</details>

---

## ✨ What is Checkstack?

**Checkstack** is a self-hosted, open-source status page and monitoring platform that helps you:

- 📊 **Monitor** your services with automated health checks
- 📢 **Communicate** incidents, maintenance, and announcements to your users
- 🔔 **Notify** stakeholders through multiple channels instantly
- 🔌 **Integrate** with your existing tools and workflows

Think of it as your all-in-one solution for operational visibility - combining the power of a status page, uptime monitoring, and incident management into a single, extensible platform.

## 🚀 Key Features

### System Catalog
> *Your single source of truth for all monitored services*

Organize your infrastructure into **Systems** and **Groups**. Track dependencies, assign owners, and maintain a clear inventory of everything that matters.

---

### Health Checks
> *Know when things break - before your users do*

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

**Features:**
- ⚡ **Flexible Assertions** - Validate response time, status, content, numeric comparisons
- 📊 **Historical Data** - Multi-tier storage with automatic aggregation for trend analysis
- 🔌 **Pluggable Architecture** - Create custom check strategies for any protocol

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

### External Integrations
> *Connect to your existing ecosystem*

| Integration | Use Case |
|-------------|----------|
| 🎫 **Jira** | Auto-create tickets from incidents |
| 💼 **Microsoft Teams** | Post to channels and manage conversations |
| 🌐 **Webex** | Post to Webex spaces with Adaptive Cards |
| 🔗 **Webhooks** | Custom HTTP callbacks for any event |

Event-driven architecture means you can react to health changes, incidents, and maintenance with automated workflows.

---

### API & Automation
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
- 🔗 **Integration Providers** - Connect to new external services
- 📡 **Notification Strategies** - Deliver alerts through new channels
- ✅ **Health Check Strategies** - Monitor services in custom ways

## 🖥️ Technology Stack

| Layer | Technologies |
|-------|--------------|
| **Runtime** | [Bun](https://bun.sh) |
| **Backend** | [Hono](https://hono.dev), [Drizzle ORM](https://orm.drizzle.team), [PostgreSQL](https://postgresql.org) |
| **Frontend** | [React](https://react.dev), [Vite](https://vitejs.dev), [TailwindCSS](https://tailwindcss.com), [ShadCN/UI](https://ui.shadcn.com) |
| **Validation** | [Zod](https://zod.dev) |
| **Realtime** | WebSocket (native Bun) |
| **Queue** | BullMQ (Redis) / In-Memory |

## 📦 Deployment

### Docker

The easiest way to run Checkstack — works for both **production deployment** and **local testing**.

**👉 [Full Docker Getting Started Guide](./docs/getting-started/docker.md)**

#### Quick Start with Docker Compose

The repository includes a ready-to-use `docker-compose.yml`:

```bash
# Create .env with required secrets (see docs for details)
# Then start everything
docker compose up -d
```

To update to the latest version:

```bash
docker compose pull && docker compose up -d
```

#### Single Container

Checkstack requires four environment variables:

| Variable | Description | How to Generate |
|----------|-------------|-----------------|
| `DATABASE_URL` | PostgreSQL connection string | Your database provider |
| `ENCRYPTION_MASTER_KEY` | 64 hex chars (32 bytes) | `openssl rand -hex 32` |
| `BETTER_AUTH_SECRET` | Min 32 characters | `openssl rand -base64 32` |
| `BASE_URL` | Exact URL used to access Checkstack in the browser | e.g. `http://192.168.1.123:3000` or `https://status.example.com` |

```bash
# Pull and run the latest version
docker pull ghcr.io/enyineer/checkstack:latest
docker run -d \
  -e DATABASE_URL="postgresql://user:pass@host:5432/checkstack" \
  -e ENCRYPTION_MASTER_KEY="$(openssl rand -hex 32)" \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e BASE_URL="http://192.168.1.123:3000" \ 
  -p 3000:3000 \
  ghcr.io/enyineer/checkstack:latest
```

> [!TIP]
> After first start, you'll have to create your first admin user.
>
> Upon opening the page eg. at `http://localhost:3000` you'll be greeted with a signup form.


### NPM Packages

All `@checkstack/*` packages are published to npm for plugin developers.

> ⚠️ **Bun Required**: These packages publish TypeScript source directly and require [Bun](https://bun.sh) runtime. They are **not compatible with Node.js**.

```bash
# Example: Install packages for a custom plugin
bun add @checkstack/backend-api @checkstack/common
```

## 🏃 Development Setup

> For **contributors** and **plugin developers**. For just running Checkstack, use [Docker](#docker) instead.

### Prerequisites

- [Bun](https://bun.sh) installed
- [Docker Desktop](https://www.docker.com/products/docker-desktop) running

### Run the Development Environment

```bash
# Clone the repository
git clone https://github.com/enyineer/checkstack.git
cd checkstack

# Install dependencies
bun install

# Start everything (Docker + Backend + Frontend)
bun run dev
```

This command will automatically:
1. 🐳 Start the Docker infrastructure (Postgres & PgAdmin)
2. 🔧 Start the Backend server (Port 3000)
3. 🎨 Start the Frontend server (Vite default port)

> [!TIP]
> After first start, you'll have to create your first admin user.
>
> Upon opening the page eg. at `http://localhost:3000` you'll be greeted with a signup form.

### Infrastructure Details

| Service | URL | Credentials |
|---------|-----|-------------|
| **Frontend** | `http://localhost:5173` | - |
| **Backend API** | `http://localhost:3000` | - |
| **PgAdmin** | `http://localhost:5050` | `admin@checkstack.com` / `admin` |
| **PostgreSQL** | `localhost:5432` | `checkstack` / `checkstack` |

```bash
# Stop Docker containers
bun run docker:stop
```

## 📚 Documentation

For comprehensive guides, API references, and plugin development docs:

**👉 [View Full Documentation](./docs/README.md)**

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