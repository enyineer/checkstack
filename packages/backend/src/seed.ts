import { adminPool } from "./db";

async function main() {
  console.log("🌱 Seeding database...");

  // Seed initial users or configuration if needed
  // Plugins are now discovered automatically if in the monorepo
  console.log(
    "ℹ️  Skipping hardcoded plugin seeding (auto-discovery enabled)."
  );

  try {
    // Other seeding logic could go here
    console.log("✅ Seeded base data.");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
  } finally {
    await adminPool.end();
  }
}

await main();
