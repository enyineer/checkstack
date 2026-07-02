import { describe, expect, it } from "bun:test";
import { qualifyNotificationUrls, toAbsoluteUrl } from "./notification-urls";
import type { NotificationSubject } from "./schemas";

const subject = (
  overrides: Partial<NotificationSubject> = {},
): NotificationSubject => ({
  kind: "catalog.system",
  id: "sys-1",
  name: "Checkout",
  ...overrides,
});

describe("toAbsoluteUrl", () => {
  it("prepends the base URL to a relative path (result is absolute)", () => {
    const result = toAbsoluteUrl({
      baseUrl: "https://status.example.com",
      url: "/catalog/systems/sys-1",
    });
    expect(result).toBe("https://status.example.com/catalog/systems/sys-1");
    expect(result).toMatch(/^https:\/\//);
  });

  it("returns an already-absolute http(s) URL unchanged", () => {
    expect(
      toAbsoluteUrl({
        baseUrl: "https://status.example.com",
        url: "https://other.example.com/x",
      }),
    ).toBe("https://other.example.com/x");
    expect(
      toAbsoluteUrl({
        baseUrl: "https://status.example.com",
        url: "http://other.example.com/x",
      }),
    ).toBe("http://other.example.com/x");
  });

  it("is case-insensitive when detecting an absolute scheme", () => {
    expect(
      toAbsoluteUrl({
        baseUrl: "https://status.example.com",
        url: "HTTPS://Other.Example.com/x",
      }),
    ).toBe("HTTPS://Other.Example.com/x");
  });

  it("collapses a trailing slash on the base URL (no double slash)", () => {
    expect(
      toAbsoluteUrl({
        baseUrl: "https://status.example.com/",
        url: "/catalog/systems/sys-1",
      }),
    ).toBe("https://status.example.com/catalog/systems/sys-1");
  });

  it("inserts a slash when the path has no leading slash", () => {
    expect(
      toAbsoluteUrl({
        baseUrl: "https://status.example.com",
        url: "catalog/systems/sys-1",
      }),
    ).toBe("https://status.example.com/catalog/systems/sys-1");
  });

  it("returns the relative url unchanged when baseUrl is undefined", () => {
    expect(toAbsoluteUrl({ url: "/catalog/systems/sys-1" })).toBe(
      "/catalog/systems/sys-1",
    );
  });

  it("returns the relative url unchanged when baseUrl is empty", () => {
    expect(
      toAbsoluteUrl({ baseUrl: "", url: "/catalog/systems/sys-1" }),
    ).toBe("/catalog/systems/sys-1");
  });

  it("returns the relative url unchanged when baseUrl is null", () => {
    expect(
      toAbsoluteUrl({ baseUrl: null, url: "/catalog/systems/sys-1" }),
    ).toBe("/catalog/systems/sys-1");
  });
});

describe("qualifyNotificationUrls", () => {
  it("qualifies the action url and every subject url", () => {
    const result = qualifyNotificationUrls({
      baseUrl: "https://status.example.com",
      action: { label: "View incident", url: "/incident/incidents/inc-1" },
      subjects: [
        subject({ id: "sys-1", url: "/catalog/systems/sys-1" }),
        subject({ id: "sys-2", url: "/catalog/systems/sys-2" }),
      ],
    });

    expect(result.action?.url).toBe(
      "https://status.example.com/incident/incidents/inc-1",
    );
    expect(result.subjects?.[0]?.url).toBe(
      "https://status.example.com/catalog/systems/sys-1",
    );
    expect(result.subjects?.[1]?.url).toBe(
      "https://status.example.com/catalog/systems/sys-2",
    );
    for (const s of result.subjects ?? []) {
      expect(s.url).toMatch(/^https:\/\//);
    }
  });

  it("leaves a subject without a url untouched", () => {
    const result = qualifyNotificationUrls({
      baseUrl: "https://status.example.com",
      subjects: [subject({ url: undefined })],
    });
    expect(result.subjects?.[0]?.url).toBeUndefined();
    expect(result.subjects?.[0]?.name).toBe("Checkout");
  });

  it("passes through when there is no action and no subjects", () => {
    const result = qualifyNotificationUrls({
      baseUrl: "https://status.example.com",
    });
    expect(result.action).toBeUndefined();
    expect(result.subjects).toBeUndefined();
  });

  it("keeps links relative when baseUrl is missing (sensible fallback)", () => {
    const result = qualifyNotificationUrls({
      action: { label: "View", url: "/incident/incidents/inc-1" },
      subjects: [subject({ url: "/catalog/systems/sys-1" })],
    });
    expect(result.action?.url).toBe("/incident/incidents/inc-1");
    expect(result.subjects?.[0]?.url).toBe("/catalog/systems/sys-1");
  });

  it("does not mutate the caller's action or subject references", () => {
    const action = { label: "View", url: "/incident/incidents/inc-1" };
    const subjects = [subject({ url: "/catalog/systems/sys-1" })];

    qualifyNotificationUrls({
      baseUrl: "https://status.example.com",
      action,
      subjects,
    });

    expect(action.url).toBe("/incident/incidents/inc-1");
    expect(subjects[0]?.url).toBe("/catalog/systems/sys-1");
  });
});
