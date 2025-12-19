import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createBackendPlugin } from "@checkmate/backend/src/plugin-system";
import { coreServices } from "@checkmate/core-api";
import { userInfoRef } from "./services/user-info";
import * as schema from "./schema";

export default createBackendPlugin({
  pluginId: "auth-backend",
  register(env) {
    let auth: ReturnType<typeof betterAuth> | undefined;

    // 1. Register User Info Service
    env.registerService(userInfoRef, {
      getUser: async (headers: Headers) => {
        if (!auth) {
          throw new Error("Auth backend not initialized");
        }
        const session = await auth.api.getSession({
          headers,
        });
        return session?.user || null;
      },
    });

    // 2. Register Authentication Strategy (for Core Middleware)
    env.registerService(coreServices.authentication, {
      validate: async (request: Request) => {
        if (!auth) {
          return null; // Not initialized yet
        }
        // better-auth needs headers to validate session
        const session = await auth.api.getSession({
          headers: request.headers,
        });
        return session?.user || null;
      },
    });

    // 3. Register Init logic
    env.registerInit({
      deps: {
        database: coreServices.database,
        router: coreServices.httpRouter,
        logger: coreServices.logger,
      },
      init: async ({ database, router, logger }) => {
        logger.info("Initializing Auth Backend...");

        auth = betterAuth({
          database: drizzleAdapter(database, {
            provider: "pg",
            schema: { ...schema },
          }),
          emailAndPassword: { enabled: true },
        });

        router.on(["POST", "GET"], "/*", (c) => {
          return auth!.handler(c.req.raw);
        });

        logger.info("✅ Auth Backend initialized.");
      },
    });
  },
});
