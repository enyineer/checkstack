<p align="center">
  <h1 align="center">🏁 Checkmate</h1>
  <p align="center">
    <strong>The Modern Status Page & Monitoring Platform</strong>
  </p>
  <p align="center">
    Monitor your systems. Keep users informed. Maintain trust.
  </p>
</p>

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
> Checkmate is currently in **alpha** and is not ready for production use.
>
> Breaking changes are to be expected regularly in this development phase. We're still happy if you try it out and give us feedback!

## ✨ What is Checkmate?

**Checkmate** is a self-hosted, open-source status page and monitoring platform that helps you:

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
| 🔔 **In-App** | Realtime notification center with read/unread tracking |

Subscribe users to systems and automatically notify them on status changes.

---

### External Integrations
> *Connect to your existing ecosystem*

| Integration | Use Case |
|-------------|----------|
| 🎫 **Jira** | Auto-create tickets from incidents |
| 🌐 **Webhooks** | Custom HTTP callbacks for any event |

Event-driven architecture means you can react to health changes, incidents, and maintenance with automated workflows.

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

Checkmate is built from the ground up as a **modular plugin system**:

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

## 🏃 Quick Start

### Prerequisites

- [Bun](https://bun.sh) installed
- [Docker Desktop](https://www.docker.com/products/docker-desktop) running

### Run Locally

```bash
# Clone the repository
git clone https://github.com/enyineer/checkmate.git
cd checkmate

# Install dependencies
bun install

# Start everything (Docker + Backend + Frontend)
bun run dev
```

This command will automatically:
1. 🐳 Start the Docker infrastructure (Postgres & PgAdmin)
2. 🔧 Start the Backend server (Port 3000)
3. 🎨 Start the Frontend server (Vite default port)

### Infrastructure Details

| Service | URL | Credentials |
|---------|-----|-------------|
| **Frontend** | `http://localhost:5173` | - |
| **Backend API** | `http://localhost:3000` | - |
| **PgAdmin** | `http://localhost:5050` | `admin@checkmate-monitor.com` / `admin` |
| **PostgreSQL** | `localhost:5432` | `checkmate` / `checkmate` |

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

**Need a commercial license?** [Contact us](mailto:hi@enking.dev)

---

<p align="center">
  <sub>Built with ❤️ for reliability engineers everywhere</sub>
</p>