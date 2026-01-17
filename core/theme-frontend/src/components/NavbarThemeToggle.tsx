import { Moon, Sun } from "lucide-react";
import { useApi } from "@checkstack/frontend-api";
import { authApiRef } from "@checkstack/auth-frontend/api";
import { Button, useTheme } from "@checkstack/ui";

/**
 * Navbar theme toggle button for non-logged-in users.
 *
 * Shows a Sun/Moon icon button that toggles between light and dark themes.
 * Only renders when user is NOT logged in (logged-in users use the toggle in UserMenu).
 *
 * Theme changes are saved to local storage via ThemeProvider.
 */
export const NavbarThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const authApi = useApi(authApiRef);
  const { data: session, isPending } = authApi.useSession();

  // Don't render while loading session
  if (isPending) {
    return;
  }

  // Don't render for logged-in users (they use UserMenu toggle)
  if (session?.user) {
    return;
  }

  const isDark = resolvedTheme === "dark";

  const handleToggle = () => {
    const newTheme = isDark ? "light" : "dark";
    setTheme(newTheme);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-full"
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
};
