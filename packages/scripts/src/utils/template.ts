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
      const targetFileName = isTemplate ? item.slice(0, -4) : item; // Remove .hbs extension
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
}: {
  baseName: string;
  pluginType: string;
  description: string;
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
  };
}
