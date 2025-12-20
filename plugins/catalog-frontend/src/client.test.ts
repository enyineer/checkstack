import { describe, it, expect, mock } from "bun:test";
import { CatalogClient } from "./client";
import { FetchApi } from "@checkmate/frontend-api";

describe("CatalogClient", () => {
  const mockFetch = mock(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ systems: [], groups: [] }),
    } as Response)
  );

  const mockFetchApi = {
    forPlugin: () => ({
      fetch: mockFetch,
    }),
  } as unknown as FetchApi;

  const client = new CatalogClient(mockFetchApi);

  it("should get systems", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ systems: [{ id: "s1", name: "System 1" }] }),
    } as Response);

    const systems = await client.getSystems();
    expect(systems).toHaveLength(1);
    expect(systems[0].id).toBe("s1");
    expect(mockFetch).toHaveBeenCalledWith("/entities", undefined);
  });

  it("should create system", async () => {
    const newSystem = { name: "New System" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "new-s", ...newSystem }),
    } as Response);

    const system = await client.createSystem(newSystem);
    expect(system.id).toBe("new-s");
    expect(mockFetch).toHaveBeenCalledWith(
      "/entities/systems",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(newSystem),
      })
    );
  });

  it("should update system", async () => {
    const update = { name: "Updated System" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: "s1", ...update }),
    } as Response);

    const system = await client.updateSystem("s1", update);
    expect(system.name).toBe("Updated System");
    expect(mockFetch).toHaveBeenCalledWith(
      "/entities/systems/s1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(update),
      })
    );
  });

  it("should delete system", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);

    await client.deleteSystem("s1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/entities/systems/s1",
      expect.objectContaining({
        method: "DELETE",
      })
    );
  });
});
