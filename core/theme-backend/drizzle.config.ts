export default {
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: (() => {
      if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be defined");
      return process.env.DATABASE_URL;
    })(),
  },
};
