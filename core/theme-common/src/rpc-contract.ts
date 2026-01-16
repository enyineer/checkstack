import { createClientDefinition, proc } from "@checkstack/common";
import { pluginMetadata } from "./plugin-metadata";
import { z } from "zod";

// Theme type - matches ThemeProvider's Theme type
export const ThemeSchema = z.enum(["light", "dark", "system"]);
export type Theme = z.infer<typeof ThemeSchema>;

// Theme RPC Contract
export const themeContract = {
  // Get current user's theme preference
  // User-only - each user reads their own theme
  getTheme: proc({
    operationType: "query",
    userType: "user",
    access: [],
  }).output(
    z.object({
      theme: ThemeSchema,
    })
  ),

  // Set current user's theme preference
  // User-only - each user sets their own theme
  setTheme: proc({
    operationType: "mutation",
    userType: "user",
    access: [],
  })
    .input(
      z.object({
        theme: ThemeSchema,
      })
    )
    .output(z.void()),
};

// Export contract type
export type ThemeContract = typeof themeContract;

// Export client definition for type-safe forPlugin usage
// Use: const client = rpcApi.forPlugin(ThemeApi);
export const ThemeApi = createClientDefinition(themeContract, pluginMetadata);
