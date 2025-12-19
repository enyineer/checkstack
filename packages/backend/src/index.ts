import { Hono } from "hono";
import { PluginManager } from "./plugin-manager";
import { logger } from "hono/logger";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./db";
import { join } from "path";
import { jwtService } from "./services/jwt";
import { rootLogger } from "./logger";
import { coreServices } from "@checkmate/core-api";

const app = new Hono();
const pluginManager = new PluginManager();

app.use("*", logger());

app.get("/", (c) => {
  return c.text("Checkmate Core Backend is running!");
});

const init = async () => {
  rootLogger.info("🚀 Starting Checkmate Core...");

  // 1. Run Core Migrations
  rootLogger.info("🔄 Running core migrations...");
  try {
    await migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
    rootLogger.info("✅ Core migrations applied.");
  } catch (e) {
    rootLogger.error("❌ Failed to apply core migrations:", e);
    process.exit(1);
  }

  // 2. Signature Verification Middleware
  // Verify that every request coming to /api/* has a valid signature, unless exempt.
  // The 'auth-backend' plugin routes (/api/auth/*) must be exempt to allow login/signup.
  const EXEMPT_PATHS = ["/api/auth"];

  app.use("/api/*", async (c, next) => {
    const path = c.req.path;

    // Check exemptions (prefix match)
    if (EXEMPT_PATHS.some((p) => path.startsWith(p))) {
      return next();
    }

    const token = c.req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return c.json(
        { error: "Unauthorized: Missing Authorization header" },
        401
      );
    }

    // 5. Dual Authentication Strategy
    // Strategy A: Service Token (Stateless, signed by Core)
    const payload = await jwtService.verify(token);
    if (payload) {
      // It's a valid Service Token
      // c.set('jwtPayload', payload); // If we wanted to pass it down
      return next();
    }

    // Strategy B: User Token (Stateful, validated by Auth Plugin)
    // We try to retrieve the registered AuthenticationStrategy
    const authStrategy = await pluginManager.getService(
      coreServices.authentication
    );

    if (authStrategy) {
      const user = await authStrategy.validate(c.req.raw);
      if (user) {
        // It's a valid User Session
        // c.set('user', user); // If we wanted to pass it down
        return next();
      }
    }

    // Both failed
    return c.json({ error: "Unauthorized: Invalid token or session" }, 401);
  });

  // 3. Load Plugins
  await pluginManager.loadPluginsFromDb(app);

  rootLogger.info("✅ Checkmate Core initialized.");
};

init();

export default {
  port: 3000,
  fetch: app.fetch,
};

export { jwtService } from "./services/jwt";
