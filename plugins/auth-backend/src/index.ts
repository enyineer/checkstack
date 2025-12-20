import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createBackendPlugin } from "@checkmate/backend-api";
import { coreServices } from "@checkmate/backend-api";
import { userInfoRef } from "./services/user-info";
import * as schema from "./schema";
import { eq } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { User } from "better-auth/types";
import { hashPassword } from "better-auth/crypto";
import { createExtensionPoint } from "@checkmate/backend-api";
import { enrichUser } from "./utils/user";

export interface BetterAuthStrategy {
  id: string;
  config: Record<string, unknown>;
}

export interface BetterAuthExtensionPoint {
  addStrategy(strategy: BetterAuthStrategy): void;
}

export const betterAuthExtensionPoint =
  createExtensionPoint<BetterAuthExtensionPoint>(
    "auth.betterAuthExtensionPoint"
  );

export default createBackendPlugin({
  pluginId: "auth-backend",
  register(env) {
    let auth: ReturnType<typeof betterAuth> | undefined;
    let db: NodePgDatabase<typeof schema> | undefined;
    let tokenVerification:
      | import("@checkmate/backend-api").TokenVerification
      | undefined;

    const strategies: BetterAuthStrategy[] = [];

    env.registerExtensionPoint(betterAuthExtensionPoint, {
      addStrategy: (s) => strategies.push(s),
    });

    // Helper: Verify Service Token
    const verifyServiceToken = async (
      headers: Headers
    ): Promise<
      | {
          id: string;
          permissions: string[];
          roles: string[];
        }
      | undefined
    > => {
      if (!tokenVerification) return undefined;

      const authHeader = headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return undefined;

      const token = authHeader.split(" ")[1];
      try {
        const payload = await tokenVerification.verify(token);
        if (!payload) return undefined;

        // It's a valid service token
        return {
          id: (payload.sub as string) || "service",
          permissions: ["*"], // Grant all permissions
          roles: ["service"],
        };
      } catch {
        return undefined;
      }
    };

    // Helper to fetch permissions
    const enrichUserLocal = async (user: User) => {
      if (!db) return user;
      return enrichUser(user, db);
    };

    // 1. Register User Info Service
    env.registerService(userInfoRef, {
      getUser: async (headers: Headers) => {
        if (!auth) {
          throw new Error("Auth backend not initialized");
        }

        // Try Service Token First
        const serviceUser = await verifyServiceToken(headers);
        if (serviceUser) return serviceUser;

        const session = await auth.api.getSession({
          headers,
        });
        if (!session?.user) return;
        return enrichUserLocal(session.user);
      },
    });

    // 2. Register Authentication Strategy (for Core Middleware)
    env.registerService(coreServices.authentication, {
      validate: async (request: Request) => {
        if (!auth) {
          return; // Not initialized yet
        }

        // Try Service Token First
        const serviceUser = await verifyServiceToken(request.headers);
        if (serviceUser) return serviceUser;

        // better-auth needs headers to validate session
        const session = await auth.api.getSession({
          headers: request.headers,
        });
        if (!session?.user) return;
        return enrichUserLocal(session.user);
      },
    });

    // 3. Register Init logic
    env.registerInit({
      schema,
      deps: {
        database: coreServices.database,
        router: coreServices.httpRouter,
        logger: coreServices.logger,
        tokenVerification: coreServices.tokenVerification,
      },
      init: async ({ database, router, logger, tokenVerification: tv }) => {
        logger.info("Initializing Auth Backend...");

        db = database;
        tokenVerification = tv;

        const socialProviders: Record<string, unknown> = {};
        for (const s of strategies) {
          logger.info(`   -> Adding auth strategy: ${s.id}`);
          socialProviders[s.id] = s.config;
        }

        auth = betterAuth({
          database: drizzleAdapter(database, {
            provider: "pg",
            schema: { ...schema },
          }),
          emailAndPassword: { enabled: true },
          socialProviders,
          basePath: "/api/auth-backend",
          baseURL: process.env.VITE_API_BASE_URL || "http://localhost:3000",
          trustedOrigins: [process.env.FRONTEND_URL || "http://localhost:5173"],
        });

        // 4. Register permissions endpoint (BEFORE catch-all)
        router.get("/permissions", async (c) => {
          const session = await auth!.api.getSession({
            headers: c.req.raw.headers,
          });

          if (!session?.user) {
            return c.json({ error: "Unauthorized" }, 401);
          }

          const enrichedUser = await enrichUserLocal(session.user);
          const permissions =
            "permissions" in enrichedUser ? enrichedUser.permissions : [];
          return c.json({ permissions });
        });

        router.all("*", (c) => {
          return auth!.handler(c.req.raw);
        });

        // 4. Idempotent Seeding
        logger.info("🌱 Checking for initial admin user...");
        const adminRole = await database
          .select()
          .from(schema.role)
          .where(eq(schema.role.id, "admin"));
        if (adminRole.length === 0) {
          await database.insert(schema.role).values({
            id: "admin",
            name: "Administrator",
            isSystem: true,
          });
          logger.info("   -> Created 'admin' role.");
        }

        const adminUser = await database
          .select()
          .from(schema.user)
          .where(eq(schema.user.email, "admin@checkmate.local"));

        if (adminUser.length === 0) {
          const adminId = "initial-admin-id";
          await database.insert(schema.user).values({
            id: adminId,
            name: "Admin",
            email: "admin@checkmate.local",
            emailVerified: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          const hashedAdminPassword = await hashPassword("admin");
          await database.insert(schema.account).values({
            id: "initial-admin-account-id",
            accountId: "admin@checkmate.local",
            providerId: "credential",
            userId: adminId,
            password: hashedAdminPassword,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          await database.insert(schema.userRole).values({
            userId: adminId,
            roleId: "admin",
          });

          logger.info(
            "   -> Created initial admin user (admin@checkmate.local : admin)"
          );
        }

        logger.info("✅ Auth Backend initialized.");
      },
    });
  },
});
