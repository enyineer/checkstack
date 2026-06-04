import { describe, expect, it } from "bun:test";
import type { AuditAdvisory } from "@checkstack/script-packages-common";
import { countBySeverity, meetsThreshold, parseBunAudit } from "./audit-parse";

describe("parseBunAudit", () => {
  it("parses the package-keyed advisory document", () => {
    const stdout = JSON.stringify({
      lodash: [
        {
          id: 1106913,
          url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
          title: "Command Injection in lodash",
          severity: "high",
          vulnerable_versions: "<4.17.21",
          cvss: { score: 7.2, vectorString: "CVSS:3.1/..." },
        },
      ],
    });
    const { advisories } = parseBunAudit(stdout);
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toEqual({
      packageName: "lodash",
      advisoryId: "1106913",
      title: "Command Injection in lodash",
      severity: "high",
      vulnerableVersions: "<4.17.21",
      url: "https://github.com/advisories/GHSA-35jh-r3h4-6jhm",
      cvssScore: 7.2,
    });
  });

  it("treats {} (clean tree) and [] (no deps) as no advisories", () => {
    expect(parseBunAudit("{}").advisories).toEqual([]);
    expect(parseBunAudit("[]").advisories).toEqual([]);
    expect(parseBunAudit("   ").advisories).toEqual([]);
    expect(parseBunAudit("").advisories).toEqual([]);
  });

  it("sorts deterministically by package then advisory id", () => {
    const stdout = JSON.stringify({
      zod: [{ id: 200, severity: "low", vulnerable_versions: "<1" }],
      lodash: [
        { id: 30, severity: "high", vulnerable_versions: "<2" },
        { id: 10, severity: "moderate", vulnerable_versions: "<3" },
      ],
    });
    const { advisories } = parseBunAudit(stdout);
    expect(advisories.map((a) => `${a.packageName}:${a.advisoryId}`)).toEqual([
      "lodash:10",
      "lodash:30",
      "zod:200",
    ]);
  });

  it("maps 'medium' to 'moderate' and coerces unknown severities to 'low'", () => {
    const stdout = JSON.stringify({
      a: [{ id: 1, severity: "medium", vulnerable_versions: "<1" }],
      b: [{ id: 2, severity: "spooky", vulnerable_versions: "<1" }],
    });
    const { advisories } = parseBunAudit(stdout);
    expect(advisories.find((x) => x.packageName === "a")?.severity).toBe(
      "moderate",
    );
    expect(advisories.find((x) => x.packageName === "b")?.severity).toBe("low");
  });

  it("dedups the same (package, advisory) and skips entries with no id", () => {
    const stdout = JSON.stringify({
      lodash: [
        { id: 5, severity: "high", vulnerable_versions: "<1" },
        { id: 5, severity: "high", vulnerable_versions: "<1" },
        { severity: "high", vulnerable_versions: "<1" },
      ],
    });
    const { advisories } = parseBunAudit(stdout);
    expect(advisories).toHaveLength(1);
  });

  it("tolerates missing optional fields and null cvss", () => {
    const stdout = JSON.stringify({
      pkg: [{ id: 9, severity: "critical" }],
    });
    const { advisories } = parseBunAudit(stdout);
    expect(advisories[0]).toMatchObject({
      title: "",
      vulnerableVersions: "",
      url: null,
      cvssScore: null,
    });
  });

  it("throws on non-JSON output", () => {
    expect(() => parseBunAudit("error: registry unreachable")).toThrow();
  });
});

describe("countBySeverity", () => {
  it("counts each bucket and always returns all four", () => {
    const advisories: AuditAdvisory[] = (
      [
        ["a", "1", "low"],
        ["b", "2", "high"],
        ["c", "3", "high"],
        ["d", "4", "critical"],
      ] as const
    ).map(([packageName, advisoryId, severity]) => ({
      packageName,
      advisoryId,
      severity,
      title: "",
      vulnerableVersions: "",
      url: null,
      cvssScore: null,
    }));
    const counts = countBySeverity(advisories);
    expect(counts).toEqual({ low: 1, moderate: 0, high: 2, critical: 1 });
  });
});

describe("meetsThreshold", () => {
  it("compares by ordinal rank", () => {
    expect(meetsThreshold("low", "moderate")).toBe(false);
    expect(meetsThreshold("moderate", "moderate")).toBe(true);
    expect(meetsThreshold("high", "moderate")).toBe(true);
    expect(meetsThreshold("critical", "high")).toBe(true);
    expect(meetsThreshold("moderate", "high")).toBe(false);
  });
});
