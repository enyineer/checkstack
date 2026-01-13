# Documentation Index

Welcome to the Checkstack documentation! This index will help you find the information you need.

## Getting Started

New to Checkstack? Start here:

1. **[Project README](https://github.com/enyineer/checkstack#readme)** - Project overview and setup instructions
2. **[Docker Deployment](./getting-started/docker.md)** - Deploy Checkstack with Docker
3. **[Contributing Guide](./getting-started/contributing.md)** - Set up your development environment

## Architecture

Understanding the system design:

- **[Plugin Architecture](./architecture/plugin-system.md)** - Core pluggable architecture and extension model
- **[Packages vs Plugins](./architecture/packages-vs-plugins.md)** - When to use packages vs plugins

## Backend Development

Building backend plugins and services:

- **[Backend Plugins](./backend/plugins.md)** - Create REST APIs, services, and database schemas
- **[Service Communication](./backend/services.md)** - Backend-to-backend communication patterns
- **[Config Service](./backend/config-service.md)** - Dynamic configuration management
- **[Queue System](./backend/queue-system.md)** - Asynchronous task processing
- **[Signals](./backend/signals.md)** - Realtime server-to-client communication
- **[Versioned Configs](./backend/versioned-configs.md)** - Schema evolution and migrations
- **[Drizzle Schema](./backend/drizzle-schema.md)** - Database schema isolation
- **[Health Check Data Management](./backend/healthcheck-data-management.md)** - Tiered storage, aggregation, and retention
- **[Health Check Strategies](./backend/healthcheck-strategies.md)** - Building health check providers with assertions
- **[Notification Strategies](./backend/notification-strategies.md)** - Building notification delivery channels
- **[Integration System](./backend/integration-system.md)** - External system integration architecture
- **[Integration Events](./backend/integration-events.md)** - Event-driven integration hooks
- **[Integration Providers](./backend/integration-providers.md)** - Building integration providers

## Frontend Development

Building frontend plugins and UI:

- **[Frontend Plugins](./frontend/plugins.md)** - Create UI components, pages, and routing
- **[Extension Points](./frontend/extension-points.md)** - UI slots and extension system
- **[Theming](./frontend/theming.md)** - Design tokens and theme customization
- **[Config Schemas](./frontend/config-schemas.md)** - Sending configuration schemas to frontend
- **[Health Check Custom Charts](./frontend/healthcheck-charts.md)** - Strategy-specific visualizations
- **[Routing](./frontend/routing.md)** - Frontend route management and navigation

## Common Packages

Sharing code between frontend and backend:

- **[Common Plugins](./common/plugins.md)** - Shared types, access rules, and contracts

## Security

Authentication and secrets management:

- **[Secrets Encryption](./security/secrets.md)** - Secret storage and encryption
- **[Auth Error Handling](./security/auth-error-handling.md)** - Custom authentication error patterns
- **[External Applications](./security/external-applications.md)** - Service accounts and API access
- **[Teams and Resource Access Control](./backend/teams.md)** - Team-based access to specific resources

## Testing

Testing utilities and patterns:

- **[Backend Test Utilities](./testing/backend-utilities.md)** - Mock factories and test helpers
- **[Frontend Testing](./testing/frontend-testing.md)** - React component and hook testing

## Examples

Common patterns and minimal templates:

- **[Queue Patterns](./examples/queue-patterns.md)** - Recurring jobs, broadcast, priority, deduplication
- **[Plugin Templates](./examples/plugin-templates.md)** - Minimal backend, frontend, and common plugins
- **[Config Patterns](./examples/config-patterns.md)** - Versioning, migrations, secrets

## Tooling

Development tools and workflows:

- **[CLI & Scaffolding](./tooling/cli.md)** - Monorepo tooling and package creation
- **[Dependency Linter](./tooling/dependency-linter.md)** - Architecture rule enforcement
- **[Changesets](./tooling/changesets.md)** - Versioning and changelog management

## Quick Reference

### Package Types

| Type | Purpose | Documentation |
|------|---------|---------------|
| Backend | REST APIs, business logic, database | [Backend Plugins](./backend/plugins.md) |
| Frontend | UI components, pages, routing | [Frontend Plugins](./frontend/plugins.md) |
| Common | Shared types, access rules, constants | [Common Plugins](./common/plugins.md) |

### Dependency Rules (Enforced)

- ✅ Common → Common only
- ✅ Frontend → Frontend or Common
- ✅ Backend → Backend or Common
- ❌ Common → Backend or Frontend
- ❌ Frontend → Backend

See [Dependency Linter](./tooling/dependency-linter.md) for enforcement details.

## Technology Stack

### Backend
- **Runtime**: Bun
- **Framework**: Hono
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod
- **Testing**: Bun test

### Frontend
- **Framework**: React
- **Routing**: React Router DOM
- **UI**: ShadCN + Tailwind CSS
- **Build**: Vite
- **Testing**: Playwright

## Getting Help

- **Documentation**: You're reading it!
- **GitHub Issues**: Report bugs or request features
- **GitHub Discussions**: Ask questions or share ideas

## Contributing

We welcome contributions! See the [Contributing Guide](./getting-started/contributing.md) for:
- Development setup
- Code style guidelines
- Testing requirements
- PR submission process

## License

Checkstack is licensed under the [Elastic License 2.0](../LICENSE.md).

---

**Need help?** Check the [Contributing Guide](./getting-started/contributing.md#getting-help) for support options.
