#!/usr/bin/env bun
import inquirer from "inquirer";
import path from "node:path";
import {
  validatePluginName,
  pluginExists,
  packageExists,
  extractBaseName,
} from "../utils/validation";
import {
  registerHelpers,
  copyTemplate,
  prepareTemplateData,
} from "../utils/template";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface PluginTypeChoice {
  name: string;
  value: string;
  description: string;
}

interface LocationChoice {
  name: string;
  value: "packages" | "plugins";
  description: string;
}

const PACKAGE_LOCATIONS: LocationChoice[] = [
  {
    name: "packages/ - Core platform component (essential, non-replaceable)",
    value: "packages",
    description: "Core platform component",
  },
  {
    name: "plugins/  - Replaceable provider (optional, swappable)",
    value: "plugins",
    description: "Replaceable provider plugin",
  },
];

const PLUGIN_TYPES: PluginTypeChoice[] = [
  {
    name: "backend   - Backend plugin with oRPC router",
    value: "backend",
    description: "Backend plugin with oRPC router",
  },
  {
    name: "frontend  - Frontend plugin with React components",
    value: "frontend",
    description: "Frontend plugin with React components",
  },
  {
    name: "common    - Common plugin with contracts and types",
    value: "common",
    description: "Common plugin with contracts and types",
  },
  {
    name: "node      - Node.js utility plugin",
    value: "node",
    description: "Node.js utility plugin",
  },
  {
    name: "react     - React component library plugin",
    value: "react",
    description: "React component library plugin",
  },
];

export async function createCommand() {
  console.log("\n🚀 Checkmate Package Generator\n");

  // Register Handlebars helpers
  registerHelpers();

  // Prompt for package location
  const { packageLocation } = await inquirer.prompt<{
    packageLocation: "packages" | "plugins";
  }>([
    {
      type: "list",
      name: "packageLocation",
      message: "Where should the package be created?",
      choices: PACKAGE_LOCATIONS,
    },
  ]);

  // Show guidance based on choice
  if (packageLocation === "packages") {
    console.log(
      "\n📦 Core packages are essential platform components that cannot be removed."
    );
    console.log(
      "   Examples: auth, catalog, notifications, queue, healthcheck, theme\n"
    );
  } else {
    console.log(
      "\n🔌 Plugins are replaceable providers that can be swapped or removed."
    );
    console.log(
      "   Examples: auth-github, auth-ldap, queue-bullmq, healthcheck-http\n"
    );
  }

  // Prompt for plugin type
  const { pluginType } = await inquirer.prompt<{ pluginType: string }>([
    {
      type: "list",
      name: "pluginType",
      message: "What type of package do you want to create?",
      choices: PLUGIN_TYPES,
    },
  ]);

  // Prompt for plugin name
  const { pluginBaseName } = await inquirer.prompt<{ pluginBaseName: string }>([
    {
      type: "input",
      name: "pluginBaseName",
      message: `Package name (e.g., 'catalog' for 'catalog-${pluginType}'):`,
      validate: (input: string) => {
        const extracted = extractBaseName(input);
        const validation = validatePluginName(extracted);
        return validation.valid || validation.error || false;
      },
      filter: (input: string) => extractBaseName(input.trim()),
    },
  ]);

  // Check if plugin already exists
  const rootDir = process.cwd();
  const existsInPlugins = pluginExists({
    baseName: pluginBaseName,
    pluginType,
    rootDir,
  });
  const existsInPackages = packageExists({
    baseName: pluginBaseName,
    pluginType,
    rootDir,
  });

  if (existsInPlugins || existsInPackages) {
    const existingLocation = existsInPackages ? "packages" : "plugins";
    console.error(
      `\n❌ Error: '${pluginBaseName}-${pluginType}' already exists in ${existingLocation}/!\n`
    );
    process.exit(1);
  }

  // Prompt for description
  const { description } = await inquirer.prompt<{ description: string }>([
    {
      type: "input",
      name: "description",
      message: "Package description (optional):",
      default: `${
        pluginBaseName.charAt(0).toUpperCase() + pluginBaseName.slice(1)
      } ${packageLocation === "packages" ? "package" : "plugin"}`,
    },
  ]);

  // Prepare template data
  const templateData = prepareTemplateData({
    baseName: pluginBaseName,
    pluginType,
    description,
  });

  // Confirm before generation
  const locationLabel = packageLocation === "packages" ? "package" : "plugin";
  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: "confirm",
      name: "confirmed",
      message: `Create ${pluginType} ${locationLabel} '${templateData.pluginName}' in ${packageLocation}/?`,
      default: true,
    },
  ]);

  if (!confirmed) {
    console.log("\n❌ Creation cancelled.\n");
    process.exit(0);
  }

  // Generate plugin from template
  console.log(
    `\n📦 Creating ${pluginType} ${locationLabel}: ${templateData.pluginName}`
  );

  const templateDir = path.join(__dirname, "..", "templates", pluginType);
  const targetDir = path.join(
    rootDir,
    packageLocation,
    templateData.pluginName
  );

  try {
    const createdFiles = copyTemplate({
      templateDir,
      targetDir,
      data: templateData,
    });

    console.log(
      `  ✓ Created directory: ${packageLocation}/${templateData.pluginName}`
    );

    // Show created files
    const relativeFiles = createdFiles.map((file) =>
      path.relative(targetDir, file)
    );
    for (const file of relativeFiles) {
      console.log(`  ✓ Generated ${file}`);
    }

    // Success message with next steps
    console.log(
      `\n✅ ${
        locationLabel.charAt(0).toUpperCase() + locationLabel.slice(1)
      } created successfully!\n`
    );
    console.log("Next steps:");
    console.log(`  1. cd ${packageLocation}/${templateData.pluginName}`);
    console.log(`  2. bun install`);

    // Type-specific instructions
    switch (pluginType) {
      case "backend": {
        console.log(`  3. Update src/schema.ts with your database schema`);
        console.log(`  4. Update src/router.ts with your RPC procedures`);
        console.log(`  5. Generate migrations: bun run drizzle-kit generate`);
        break;
      }
      case "frontend": {
        console.log(`  3. Update src/api.ts with your API client`);
        console.log(`  4. Create your page components in src/components/`);
        break;
      }
      case "common": {
        console.log(`  3. Define your permissions in src/permissions.ts`);
        console.log(`  4. Define your schemas in src/schemas.ts`);
        console.log(`  5. Define your contract in src/rpc-contract.ts`);
        break;
      }
      // No additional steps for node and react types
    }

    console.log(`  6. Review the initial changeset in .changeset/initial.md\n`);
  } catch (error) {
    console.error(`\n❌ Error creating ${locationLabel}: ${error}\n`);
    process.exit(1);
  }
}

// Run the command when executed directly
await createCommand();
