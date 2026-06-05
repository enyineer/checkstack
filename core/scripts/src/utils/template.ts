import Handlebars from "handlebars";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";

export interface TemplateData {
  pluginName: string;
  pluginBaseName: string;
  pluginNamePascal: string;
  pluginNameCamel: string;
  pluginDescription: string;
  pluginId: string;
  pluginType: string;
  currentYear: number;
  /**
   * npm scope for the *generated* packages, WITHOUT the leading `@`
   * (e.g. `acme`). Defaults to `checkstack` so the in-monorepo `create`
   * command renders byte-for-byte identical output to before. An empty
   * string means "publish the trio unscoped" (e.g. `widget-backend`),
   * which the {@link scopedPackageName} helper handles.
   */
  packageScope: string;
}

/**
 * Build a published package name from a scope + bare name. With a scope:
 * `@acme/widget-backend`; without (empty scope): `widget-backend`.
 */
export function scopedPackageName({
  packageScope,
  name,
}: {
  packageScope: string;
  name: string;
}): string {
  return packageScope ? `@${packageScope}/${name}` : name;
}

/**
 * Register custom Handlebars helpers for common case transformations
 */
export function registerHelpers() {
  Handlebars.registerHelper("pascalCase", (value: string) => {
    return value
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  });

  Handlebars.registerHelper("camelCase", (value: string) => {
    const pascal = value
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
  });

  Handlebars.registerHelper("kebabCase", (value: string) => {
    return value.toLowerCase().replaceAll(/\s+/g, "-");
  });

  Handlebars.registerHelper("year", () => {
    return new Date().getFullYear();
  });

  // `{{scoped "widget-common"}}` -> `@<packageScope>/widget-common`, or
  // just `widget-common` when packageScope is empty. The scope is read from
  // the template data root so callers don't repeat it at every use site.
  Handlebars.registerHelper(
    "scoped",
    function (this: { packageScope?: string }, name: string) {
      return scopedPackageName({
        packageScope: this.packageScope ?? "checkstack",
        name,
      });
    },
  );
}

/**
 * Process a single template file using Handlebars
 */
export function processTemplate(content: string, data: TemplateData): string {
  const template = Handlebars.compile(content);
  return template(data);
}

/**
 * Recursively copy template directory and process .hbs files
 */
export function copyTemplate({
  templateDir,
  targetDir,
  data,
}: {
  templateDir: string;
  targetDir: string;
  data: TemplateData;
}): string[] {
  const createdFiles: string[] = [];

  // Create target directory if it doesn't exist
  if (!statSync(targetDir, { throwIfNoEntry: false })) {
    mkdirSync(targetDir, { recursive: true });
  }

  // Read all items in template directory
  const items = readdirSync(templateDir);

  for (const item of items) {
    const templatePath = path.join(templateDir, item);
    const stat = statSync(templatePath);

    if (stat.isDirectory()) {
      // Recursively copy directories
      const newTargetDir = path.join(targetDir, item);
      const subFiles = copyTemplate({
        templateDir: templatePath,
        targetDir: newTargetDir,
        data,
      });
      createdFiles.push(...subFiles);
    } else if (stat.isFile()) {
      // Process files
      const isTemplate = item.endsWith(".hbs");
      let targetFileName = isTemplate ? item.slice(0, -4) : item; // Remove .hbs extension

      // Process Handlebars patterns in filename
      if (targetFileName.includes("{{")) {
        targetFileName = processTemplate(targetFileName, data);
      }

      const targetPath = path.join(targetDir, targetFileName);

      if (isTemplate) {
        // Process Handlebars template
        const content = readFileSync(templatePath, "utf8");
        const processed = processTemplate(content, data);
        writeFileSync(targetPath, processed, "utf8");
      } else {
        // Copy non-template files as-is
        const content = readFileSync(templatePath);
        writeFileSync(targetPath, content);
      }

      createdFiles.push(targetPath);
    }
  }

  return createdFiles;
}

/**
 * Prepare template data from user inputs
 */
export function prepareTemplateData({
  baseName,
  pluginType,
  description,
  packageScope = "checkstack",
}: {
  baseName: string;
  pluginType: string;
  description: string;
  /**
   * npm scope (without `@`) for the generated packages. Defaults to
   * `checkstack` (the monorepo scope); pass `""` for an unscoped trio.
   */
  packageScope?: string;
}): TemplateData {
  const pluginName = `${baseName}-${pluginType}`;
  const pluginNamePascal = baseName
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");

  const pluginNameCamel =
    pluginNamePascal.charAt(0).toLowerCase() + pluginNamePascal.slice(1);

  return {
    pluginName,
    pluginBaseName: baseName,
    pluginNamePascal,
    pluginNameCamel,
    pluginDescription: description,
    pluginId: pluginName,
    pluginType,
    currentYear: new Date().getFullYear(),
    packageScope,
  };
}
