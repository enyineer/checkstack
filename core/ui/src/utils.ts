import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Single source of truth for "you are here" active-state in navigation.
 *
 * A nav entry that points at a section root should highlight not only on its
 * exact path but on any child/detail route beneath it (prefix match), so the
 * sidebar rail and the shared `NavItem` agree. Pass the router's current
 * pathname and the entry's target path.
 */
export function isNavRouteActive({
  pathname,
  to,
}: {
  pathname: string;
  to: string;
}): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export { stripMarkdown } from "./utils/strip-markdown";
