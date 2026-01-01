import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Toggle, useTheme, useToast } from "@checkmate/ui";
import { useApi, rpcApiRef } from "@checkmate/frontend-api";
import { themeContract } from "@checkmate/theme-common";
import type { ContractRouterClient } from "@orpc/contract";

// Client type derived from the contract
type ThemeClient = ContractRouterClient<typeof themeContract>;

export const ThemeToggleMenuItem = () => {
  const { theme, setTheme } = useTheme();
  const rpcApi = useApi(rpcApiRef);
  const themeClient = rpcApi.forPlugin<ThemeClient>("theme");

  const [loading, setLoading] = useState(true);
  const [isDark, setIsDark] = useState(false);
  const toast = useToast();

  // Load theme preference from backend on mount
  useEffect(() => {
    const loadThemePreference = async () => {
      try {
        const { theme: serverTheme } = await themeClient.getTheme();
        setTheme(serverTheme);
        setIsDark(serverTheme === "dark");
      } catch (error) {
        console.error("Failed to load theme preference:", error);
      } finally {
        setLoading(false);
      }
    };

    loadThemePreference();
  }, []);

  // Update local state when theme changes
  useEffect(() => {
    setIsDark(theme === "dark");
  }, [theme]);

  const handleToggle = async (checked: boolean) => {
    const newTheme = checked ? "dark" : "light";

    // Update UI immediately
    setIsDark(checked);
    setTheme(newTheme);

    // Save to backend
    try {
      await themeClient.setTheme({ theme: newTheme });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save theme preference";
      toast.error(message);
      console.error("Failed to save theme preference:", error);
      // Revert on error
      setIsDark(!checked);
      setTheme(checked ? "light" : "dark");
    }
  };

  if (loading) {
    return; // Don't show toggle while loading
  }

  return (
    <div className="flex items-center justify-between w-full px-4 py-2 text-sm text-popover-foreground">
      <div className="flex items-center gap-2">
        {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        <span>Dark Mode</span>
      </div>
      <Toggle
        checked={isDark}
        onCheckedChange={handleToggle}
        aria-label="Toggle dark mode"
      />
    </div>
  );
};
