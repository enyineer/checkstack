import { FetchApi } from "@checkmate-monitor/frontend-api";

export class CoreFetchApi implements FetchApi {
  constructor() {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);

    return fetch(input, {
      ...init,
      headers,
      credentials: "include",
    });
  }

  forPlugin(pluginId: string): {
    fetch(path: string, init?: RequestInit): Promise<Response>;
  } {
    return {
      fetch: (path: string, init?: RequestInit) => {
        const baseUrl =
          import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
        return this.fetch(`${baseUrl}/api/${pluginId}${path}`, init);
      },
    };
  }
}
