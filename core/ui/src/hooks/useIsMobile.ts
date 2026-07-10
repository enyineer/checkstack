import { useEffect, useState } from "react";

/**
 * Matches everything BELOW Tailwind's `md` (768px).
 *
 * This must stay in lock-step with the app shell's layout breakpoint: the
 * navbar hamburger is `md:hidden` and the sidebar rail is `hidden md:flex`, so
 * "the shell is in its mobile layout" means `< md`. When this query used `sm`
 * (640px) instead, the 641-767px range rendered the mobile hamburger while
 * `useIsMobile()` still reported `false`, so the chrome menus (user, help,
 * notifications) opened as desktop popovers inside a mobile layout.
 */
const MOBILE_BREAKPOINT_QUERY = "(max-width: 767px)";

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = globalThis.matchMedia(MOBILE_BREAKPOINT_QUERY);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };
    mql.addEventListener("change", handler);
    return () => {
      mql.removeEventListener("change", handler);
    };
  }, []);

  return isMobile;
}
