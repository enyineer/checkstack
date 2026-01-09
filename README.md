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
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="AGPL-3.0" />
</p>

---

> [!WARNING]
> Checkstack is currently in **alpha** and is not ready for production use.
>
> Breaking changes are to be expected regularly in this development phase. We're still happy if you try it out and give us feedback!

## 📸 Screenshots

<details>
<summary><strong>🏠 Dashboard & Navigation</strong></summary>

### Dashboard Overview
![Dashboard Overview](assets/screenshots/dashboard-overview.png)

### Command Palette
![Command Palette](assets/screenshots/command-palette.png)

</details>

<details>
<summary><strong>✅ Health Checks</strong></summary>

### Health Check Configuration
![Health Check Configuration](assets/screenshots/health-check-configuration.png)

### Health Check Details
![Health Check Details 1](assets/screenshots/health-check-configuration-details-1.png)
![Health Check Details 2](assets/screenshots/health-check-configuration-details-2.png)

### System Details with Health Status
![System Details](assets/screenshots/system-details.png)

</details>

<details>
<summary><strong>🚨 Incidents & Maintenance</strong></summary>

### Incident Management
![Incident Configuration](assets/screenshots/incident-configuration.png)
![Incident Details](assets/screenshots/incident-details.png)

### Maintenance Windows
![Maintenance Configuration](assets/screenshots/maintenance-configuration.png)
![Maintenance Details](assets/screenshots/maintenance-details.png)

</details>

<details>
<summary><strong>📋 Catalog & Notifications</strong></summary>

### System Catalog
![Catalog Configuration](assets/screenshots/catalog-configuration.png)

### Notification Center
![Notification Overview](assets/screenshots/notification-overview.png)
![Notifications Configuration](assets/screenshots/notifications-configuration.png)

### Telegram Integration Example
![Telegram Notification](assets/screenshots/telegram-notification-example.png)

</details>

<details>
<summary><strong>🔌 Integrations & Queues</strong></summary>

### External Integrations
![Integrations Configuration](assets/screenshots/integrations-configuration.png)
![Integration Connection Details](assets/screenshots/integrations-connection-details.png)

### Queue Management
![Queue Configuration](assets/screenshots/queue-configuration.png)

</details>

<details>
<summary><strong>🔐 Authentication & Security</strong></summary>

### User Management
![Users Configuration](assets/screenshots/auth-configuration-users.png)

### Role-Based Access Control
![Roles Configuration](assets/screenshots/auth-configuration-roles.png)

### Authentication Strategies
![Strategies Configuration](assets/screenshots/auth-configuration-strategies.png)

### External Applications
![Applications Configuration](assets/screenshots/auth-configuration-applications.png)

</details>

<details>
<summary><strong>📖 API Documentation</strong></summary>

### Built-in API Docs
![API Documentation](assets/screenshots/api-docuementation.png)

</details>

---

## ✨ What is Checkstack?

**Checkstack** is a self-hosted, open-source status page and monitoring platform that helps you:

- 📊 **Monitor** your services with automated health checks
- 📢 **Communicate** incidents and maintenance to your users
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

### Multi-Channel Notifications
> *Reach people where they are*

| Channel | Description |
|---------|-------------|
| 📧 **SMTP** | Email notifications with templated content |
| 💬 **Telegram** | Instant messaging with rich formatting |
| 💼 **Microsoft Teams** | Personal chat messages via Microsoft Graph API |
| 🌐 **Webex** | Direct messages through Cisco Webex |
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

### Flexible Authentication
> *Secure access for every team*

- **Credential Login** - Built-in username/password with secure password reset
- **GitHub OAuth** - Single sign-on with GitHub
- **LDAP/AD** - Enterprise directory integration
- **RBAC** - Role-based permissions with granular controls
- **API Tokens** - Service accounts for machine-to-machine access

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

Checkstack requires four environment variables:

| Variable | Description | How to Generate |
|----------|-------------|-----------------|
| `DATABASE_URL` | PostgreSQL connection string | Your database provider |
| `ENCRYPTION_MASTER_KEY` | 64 hex chars (32 bytes) | `openssl rand -hex 32` |
| `BETTER_AUTH_SECRET` | Min 32 characters | `openssl rand -base64 32` |
| `BASE_URL` | Public URL for Checkstack | Your domain (e.g., `https://status.example.com`) |

```bash
# Pull and run the latest version
docker pull ghcr.io/enyineer/checkstack:latest
docker run -d \
  -e DATABASE_URL=postgresql://user:pass@host:5432/checkstack \
  -e ENCRYPTION_MASTER_KEY=$(openssl rand -hex 32) \
  -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
  -e BASE_URL=http://localhost:3000 \
  -p 3000:3000 \
  ghcr.io/enyineer/checkstack:latest
```

> [!TIP]
> After first start, your database is seeded with a default user.
>
> Username: admin@checkstack.com
> Password: admin
>
> You should change this password as soon as possible using the "change password" function in the user-menu.

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
> After first start, your database is seeded with a default user.
>
> Username: admin@checkstack.com
> Password: admin
>
> You should change this password as soon as possible using the "change password" function in the user-menu.

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

This project is licensed under the [**GNU Affero General Public License v3.0 (AGPL-3.0)**](LICENSE.md).

| Allowed | Required |
|---------|----------|
| ✅ Commercial use | 📝 Disclose source code |
| ✅ Modification | 📝 License and copyright notice |
| ✅ Distribution | 📝 Same license for modifications |
| ✅ Patent use | 📝 Network use is distribution |
| ✅ Private use | |

The AGPL-3.0 is a **copyleft license** that ensures this software and any modifications remain open source. If you offer this software as a service (SaaS), you must make your modifications available to users under the same license.

---

<p align="center">
  <sub>Built with ❤️ for reliability engineers everywhere</sub>
</p>