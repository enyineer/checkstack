import { db, adminPool } from "./db";
import { plugins } from "./schema";
import path from "node:path";

async function main() {
  console.log("🌱 Seeding database...");

  const verifyPluginPath = path.join(
    process.cwd(),
    "../../plugins/auth-backend"
  );
  console.log("Using Auth Plugin Path:", verifyPluginPath);

  try {
    await db
      .insert(plugins)
      .values([
        {
          name: "auth-backend",
          path: verifyPluginPath,
          isUninstallable: true,
          enabled: true,
          config: {},
        },
        {
          name: "catalog-backend",
          path: path.join(process.cwd(), "../../plugins/catalog-backend"),
          isUninstallable: true,
          enabled: true,
          config: {},
        },
        {
          name: "http-healthcheck-backend",
          path: path.join(
            process.cwd(),
            "../../plugins/http-healthcheck-backend"
          ),
          isUninstallable: true,
          enabled: true,
          config: {},
        },
      ])
      .onConflictDoNothing();

    console.log("✅ Seeded default plugins.");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
  } finally {
    await adminPool.end();
  }
}

await main();
