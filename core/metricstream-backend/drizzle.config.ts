import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  // The platform's plugin loader applies migrations from `<plugin>/drizzle`,
  // so generated SQL must land there. Running `drizzle-kit generate` after
  // editing the schema appends here.
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://localhost:5432/checkstack",
  },
});
