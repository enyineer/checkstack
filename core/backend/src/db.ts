import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Basic connection string sometimes fails with Bun + pg + docker SASL
// parsing manually or relying on pg to pick up ENV variables if we don't pass anything
// But we passed connectionString.

// Explicitly parse config or fallback to individual env vars to avoid SASL string errors
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

export const adminPool = new Pool({
  connectionString,
});

export const db = drizzle({ client: adminPool, schema });
