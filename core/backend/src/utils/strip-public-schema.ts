import fs from "node:fs";
import path from "node:path";

/**
 * Strip `"public".` schema references from all SQL migration files in a folder.
 *
 * This is called at runtime before migrations are executed, modifying the files
 * in-place to ensure they work correctly with the plugin's search_path.
 *
 * @param migrationsFolder - Path to the drizzle migrations folder
 * @returns Number of files that were modified
 */
export function stripPublicSchemaFromMigrations(
  migrationsFolder: string
): number {
  if (!fs.existsSync(migrationsFolder)) {
    return 0;
  }

  const sqlFiles = fs
    .readdirSync(migrationsFolder)
    .filter((f) => f.endsWith(".sql"));

  let modifiedCount = 0;

  for (const file of sqlFiles) {
    const filePath = path.join(migrationsFolder, file);
    const content = fs.readFileSync(filePath, "utf8");

    // Replace "public". prefix (with or without quotes around table name)
    const fixed = content.replaceAll('"public".', "");

    if (fixed !== content) {
      fs.writeFileSync(filePath, fixed, "utf8");
      modifiedCount++;
    }
  }

  return modifiedCount;
}
