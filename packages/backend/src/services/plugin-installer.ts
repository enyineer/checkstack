import { PluginInstaller } from "@checkmate/backend-api";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const execAsync = promisify(exec);

export class PluginLocalInstaller implements PluginInstaller {
  private runtimeDir: string;

  constructor(runtimeDir: string) {
    this.runtimeDir = path.resolve(runtimeDir);
    if (!fs.existsSync(this.runtimeDir)) {
      fs.mkdirSync(this.runtimeDir, { recursive: true });
    }
  }

  async install(packageName: string): Promise<{ name: string; path: string }> {
    try {
      console.log(
        `🔌 Installing plugin: ${packageName} into ${this.runtimeDir}`
      );

      // We use npm install --prefix to avoid messing with the global bun lockfile
      // and to have a self-contained node_modules in the runtime directory.
      await execAsync(
        `npm install ${packageName} --prefix ${this.runtimeDir} --no-save`
      );

      // Extract the actual package name (packageName could be a URL or @org/name@version)
      // For now, we assume it's a simple package name for the path lookup,
      // or we can parse it better.
      // A safer way is to check the recently changed folders in node_modules?
      // Or just assume the input packageName (stripped of @version) matches the folder.
      let folderName = packageName;
      if (packageName.includes("@") && !packageName.startsWith("@")) {
        folderName = packageName.split("@")[0];
      } else if (packageName.startsWith("@") && packageName.includes("@", 1)) {
        folderName = "@" + packageName.split("@")[1];
      }

      const pkgPath = path.join(this.runtimeDir, "node_modules", folderName);
      const pkgJsonPath = path.join(pkgPath, "package.json");

      if (!fs.existsSync(pkgJsonPath)) {
        throw new Error(
          `Package folder ${folderName} not found at ${pkgPath} after installation`
        );
      }

      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));

      return {
        name: pkgJson.name,
        path: pkgPath,
      };
    } catch (error) {
      console.error(`❌ Failed to install plugin ${packageName}:`, error);
      throw error;
    }
  }
}
