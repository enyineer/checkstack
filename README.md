# Checkmate System Monitor

Checkmate is a system monitor which allows you to configure Health-Checks and automatically communicate to your users if something breaks.

## Running locally

To run this project in development, run `bun run dev` in the root directory.

This command will automatically:
1. Start the Docker infrastructure (Postgres & PgAdmin).
2. Start the Backend server (Port 3000).
3. Start the Frontend server (Vite default port).

### Infrastructure

The `bun run dev` command relies on `docker-compose`. Ensure Docker Desktop is running.

- **Postgres Database**: Exposed on port `5432`.
- **PgAdmin**: Exposed on port `5050` (`http://localhost:5050`).
  - **Email**: `admin@checkmate.local`
  - **Password**: `admin`
  - **Server connection**: Use hostname `postgres` (internal Docker network) or `localhost` (if mapped). Credentials: `checkmate` / `checkmate`.

To stop the Docker containers, run:
```bash
bun run docker:stop
```

## Developer Documentation

Checkmate is built on a pluggable architecture that enables extensibility and modularity. Whether you're contributing to the core or creating plugins, these guides will help you get started:

### Core Documentation

- **[Plugin Architecture](./docs/plugin-architecture.md)** - Overview of the plugin system, core principles, and deployment options
- **[Contributing Guide](./docs/contributing.md)** - How to contribute code or plugins to the project

### Plugin Development

- **[Backend Plugins](./docs/backend-plugins.md)** - Create REST APIs, business logic, and database schemas
- **[Frontend Plugins](./docs/frontend-plugins.md)** - Build UI components, pages, and routing
- **[Common Plugins](./docs/common-plugins.md)** - Share types, permissions, and constants

### Advanced Topics

- **[Extension Points](./docs/extension-points.md)** - Implement health checks, exporters, notifications, and more
- **[Versioned Configurations](./docs/versioned-configs.md)** - Manage backward-compatible schema evolution
- **[Database Schema Isolation](./docs/drizzle-schema-isolation.md)** - How plugins get isolated database schemas
- **[Dependency Linter](./docs/dependency-linter.md)** - Enforced architecture rules

### Quick Links

- [Create a Backend Plugin](./docs/backend-plugins.md#quick-start)
- [Create a Frontend Plugin](./docs/frontend-plugins.md#quick-start)
- [Implement a Health Check Strategy](./docs/extension-points.md#healthcheckstrategy)


## License

This project is licensed under the [Elastic License 2.0](LICENSE.md).

**What this means:**
✅ **You can** use this software for free in your company (internally), for personal projects, or for research.
✅ **You can** modify the code and distribute it to others (as long as you keep the license and copyright).
✅ **You can** build commercial applications *on top* of this software (e.g., using it as a database or library).

❌ **You cannot** sell this software as a managed service (SaaS) where the software itself is the product.
❌ **You cannot** remove or hack the license keys (if applicable).

If you need to use this software as part of a managed commercial service, please [contact us](mailto:hi@enking.dev) for a commercial license.