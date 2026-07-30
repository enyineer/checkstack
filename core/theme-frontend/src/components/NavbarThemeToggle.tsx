import { useApi } from "@checkstack/frontend-api";
import { authApiRef } from "@checkstack/auth-frontend/api";
import { Button, Tooltip, useTheme } from "@checkstack/ui";
import { getThemeModeOption, nextThemeMode } from "./theme-mode.logic";
import { THEME_MODE_ICONS } from "./ThemeModeSelector";

/**
 * Navbar theme control for non-logged-in users.
 *
 * A single button that CYCLES Light -> Dark -> Auto, rather than the segmented
 * control the user menu can afford: the navbar has no room for three labelled
 * options. Auto is in the cycle deliberately - previously this button could
 * only write `light` or `dark`, so a signed-out visitor whose theme was
 * following their OS lost that the first time they touched it, with no way back.
 *
 * Only renders when the user is NOT logged in (logged-in users use the selector
 * in UserMenu). Theme changes are saved to local storage via ThemeProvider.
 */
export const NavbarThemeToggle = () => {
  const { theme, setTheme } = useTheme();
  const authApi = useApi(authApiRef);
  const { data: session, isPending } = authApi.useSession();

  // Don't render while loading session
  if (isPending) {
    return;
  }

  // Don't render for logged-in users (they use UserMenu selector)
  if (session?.user) {
    return;
  }

  const current = getThemeModeOption({ theme });
  const next = getThemeModeOption({ theme: nextThemeMode({ theme }) });
  const Icon = THEME_MODE_ICONS[theme];

  return (
    <Tooltip content={`Theme: ${current.label}. Switch to ${next.label}.`}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setTheme(nextThemeMode({ theme }))}
        aria-label={`Theme: ${current.label}. Switch to ${next.label}.`}
        className="rounded-full"
      >
        <Icon className="h-5 w-5" />
      </Button>
    </Tooltip>
  );
};
