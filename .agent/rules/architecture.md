---
trigger: always_on
---

# General Description

This project is called "checkmate". It's an Open Source solution for Healthchecks, Uptime statistics, Incident / Maintenance Management and Customer Communications.

# Core structure

- Pluggable architecture (everything besides the core is a plugin)
- Secure Service to Service communication (plugins always communicate via https with signed JWTs, using a configured secret for signing these tokens)
- Modular project structure (each plugin is a "standalone" npm package and can run on it's own, enabling monoliths but also microservice deployments)
- Bun is used as a package manager and runtime for the core and all plugins

## Folder structure

`package.json`
`packages/backend`: Includes the core and the registration functionality for backend-plugins
`packages/frontend`: Includes the core frontend and registration functionality for frontend-plugins
`plugins/<pluginName>`: Includes core plugins that will be delivered with the application per default

# Package types

- "frontend" (eg. "/plugins/pluginA-frontend") packages MUST always use React, ShadCN, react-router-dom and vite
- "backend" (eg. "/plugins/pluginA-backend") packages MUST always use Hono (https://hono.dev/) for REST endpoints, zod for validation of inputs and Drizzle (https://orm.drizzle.team/) for their database schemas
- "common" (eg. "/plugins/pluginA-common") packages MUST NOT include any frontend- or backend-specific libraries or code. They SHOULD only contain shared functionality that can be used in front- and backend-packages
- "node" (eg. "plugins/pluginA-node") packages MUST NOT include any frontend-specific librarys but MAY include backend specific libraries and are used for shared code only used in the backend
- "react" (eg. "plugins/pluginA-react") packages MUST NOT include any backend-specific librarys but MAY include frontend specific libraries or shared react components

# Plugin architecture

- Plugins MUST be registerable at runtime. This will later enable the project to load plugins from remote sources without touching any code
- Plugins MUST register themselves with the front- and backend of the core application, there MUST be a shared interface for each registration (frontend or backend) which is called from the core (IoC-pattern)
- The interface MUST include functions that the core will call to register the plugin, eg. "getName(): string" to get the plugins name
- Backend Plugins MUST NOT initialize a database connection themselves. This will always be done by the core
- The core MUST create a Schema for each registered plugin and then do migrations for the Drizzle schema exported by the backend plugin

## Example for plugin initialization with a Drizzle schema / database

### Backend Plugin

The backend Plugin must export it's schema to the core.

Example `schema.ts`:

```typescript
import { pgTable, serial, text } from "drizzle-orm/pg-core";

// NO pgSchema! Just standard tables.
export const hits = pgTable("hits", {
  id: serial("id").primaryKey(),
  path: text("path"),
});
```

Example `drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./schema.ts",
  dialect: "postgresql",
  // No special handling needed. 
  // Generates generic SQL: 'CREATE TABLE "hits" ...'
});
```

Example `index.ts`:

```typescript
import { initFunction, dependencies } from "@checkmate/core";

export default init: initFunction = (deps: dependencies) => {
  // Setup plugin, here we can use dependencies like the database connection
  // or extend a Hono router that will listen under <app-url>:<backend-port>/api/<pluginName>
}
```

### Core

Example `plugin-manager.ts`:

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { join } from "path";
import { logger } from "logger";
import { Hono } from "hono";

// Main admin pool (connects to 'public' by default)
const adminPool = new Pool({ connectionString: process.env.DATABASE_URL });

export class PluginManager {
  
  async loadPlugin(props: {
    pluginName: string,
    pluginPath: string,
    rootRouter: Hono,
  }) {
    const { pluginName, pluginPath, rootRouter } = props;

    const assignedSchema = `plugin_${pluginName}`;

    logger.debug(`🔌 Loading ${pluginName} into namespace '${assignedSchema}'`);

    // 1. Ensure Schema Exists
    // We must do this using the admin connection first
    await adminPool.query(`CREATE SCHEMA IF NOT EXISTS "${assignedSchema}"`);

    // 2. Create a "Scoped" Connection String
    // We append specific Postgres options to force the search_path.
    // This makes every query run by this client happen inside the schema automatically.
    const baseUrl = process.env.DATABASE_URL; // e.g. postgres://user:pass@host/db
    
    // TRICK: Add "?options=-c search_path=..." to the URL
    const scopedUrl = `${baseUrl}?options=-c%20search_path%3D${assignedSchema}`;

    // 3. Create the Plugin's Dedicated Pool
    const pluginPool = new Pool({ connectionString: scopedUrl });
    const pluginDb = drizzle(pluginPool);

    // 4. Run Migrations (Zero Patching!)
    // Drizzle sends "CREATE TABLE 'hits'". 
    // Postgres sees search_path is "plugin_analytics", so it creates it there.
    await migrate(pluginDb, { 
      migrationsFolder: join(pluginPath, "migrations") 
    });

    // 5. Create a Sub-router for this plugin
    const pluginRouter = new Hono();

    // 6. Make the plugin router listen under the /api/<pluginName> path
    rootRouter.route(`/api/${pluginName}`, pluginRouter);

    // 5. Initialize Plugin
    // We assume the plugin exports an init function accepting the dependencies it needs
    const pluginModule = await import(pluginName);
    
    // The plugin uses this DB instance. 
    // Even though the plugin code says 'select * from hits', 
    // Postgres automatically resolves it to 'plugin_analytics.hits'.
    await pluginModule.init({
      database: pluginDb,
      router: pluginRouter,
      // other dependencies / services a plugin needs, eg. core api
    });
  }
}
```

## Backend Extension Types

Every backend plugin CAN provide extension points which will be registered in the core. These types are used to be able to distinguish between what functionality an extension point provides.

### CheckStrategy

A "CheckStrategy" is an extension which implements a HealthCheck. HealthChecks are being called in configurable intervals and can do specific checks.

The simplest form of a CheckStrategy is a "HTTP Check". This will call a configurable HTTP(S) endpoint, using a configurable method, headers, body and timeout.

Each CheckStrategy MUST implement a common CheckStrategy-interface and provide a schema for it's configuration. This schema will later automatically generate a configuration form in the frontend that allows it's configuration.

### ExporterStrategy

An "ExporterStrategy" is an extension which implements an Exporter. Exporters either provide HTTP endpoints (eg. to export Prometheus metrics) or can create files (eg. CSV files) including all necessary information about a Systems status and Health History.

Each ExporterStrategy MUST implement a common ExporterStrategy-interface and provide a schema for it's configuration. This schema will later automatically generate a configuration form in the frontend that allows it's configuration.

### NotificationStrategy

A "NotificationStrategy" is an extension which implements a notification backend. This noticications backend will receive events about health check failures and / or created incidents or planned maintenances.

Each NotificationStrategy MUST implement a common NotificationStrategy-interface and provide a schema for it's configuration. This schema will later automatically generate a configuration form in the frontend that allows it's configuration.

### AuthenticationStrategy

A "AuthenticationStrategy" is an extension which implements and configures a Better Auth (https://www.better-auth.com/) authentication strategy.

Each "AuthenticationStrategy" MUST implement a common AuthenticationStrategy-interface and provide a schema for it's configuration. This schema will later automatically generate a configuration form in the frontend that allows it's configuration.

# Role Based Access Control

Each user can have 1-n roles configured for them. Each role can include 1-n permissions.

Permissions MUST always be prefixed with the plugin's name, eg. "pluginA.read-something", "pluginA.create-something", "pluginA.update-something", "pluginA.delete-something". This prefix will be added when the plugin is registered in the core. Plugins MUST NOT add this prefix to the permission themselves.

Core permissions are always prefixed with "core.<permission>".

Permissions are exported from each backend-plugin and MUST be configurable via the frontend by users with the permission "core.configure-permissions"

Per default, each newly registered user will have the role "anonymous" which only allows to read current incidents and planned maintenances of systems.

The first registered user will have the "admin" role which always includes every available permission ("wildcard-permission") and is not configurable.