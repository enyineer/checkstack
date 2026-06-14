import { createContext, useContext } from "react";
import type { RendererRemote } from "@checkstack/status-page-common";

/**
 * Triggers loading of the renderer remotes a published page needs (third-party
 * widget renderers). The DEFAULT is a no-op: the in-app `/status/<slug>` page
 * already has every plugin's renderer (plugins are loaded by the admin app), so
 * only the minimal custom-domain public bundle provides a real implementation.
 */
export type LoadRendererRemotes = (remotes: RendererRemote[]) => void;

const RendererRemotesContext = createContext<LoadRendererRemotes>(() => {});

export const RendererRemotesProvider = RendererRemotesContext.Provider;

export function useLoadRendererRemotes(): LoadRendererRemotes {
  return useContext(RendererRemotesContext);
}
