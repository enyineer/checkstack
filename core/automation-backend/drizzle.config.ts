import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Driver / credentials are wired via env at migration time; this is
  // generation config only.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost/checkstack",
  },
});
