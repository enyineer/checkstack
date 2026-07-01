import { describe, expect, test } from "bun:test";
import type { ImpactType } from "@checkstack/dependency-common";
import {
  edgeImpactStyle,
  impactHexColors,
  impactStrokeOpacities,
  impactStrokeWidths,
  selectedEdgeStroke,
} from "./dependencyEdge.logic";

const impactTypes: ImpactType[] = ["informational", "degraded", "critical"];

describe("impactHexColors", () => {
  test("matches the Impact legend swatch base colors", () => {
    // These MUST stay in lock-step with the legend in DependencyMapPage.tsx
    // (bg-sky-400 / bg-amber-400 / bg-red-400).
    expect(impactHexColors.informational).toBe("#38bdf8");
    expect(impactHexColors.degraded).toBe("#fbbf24");
    expect(impactHexColors.critical).toBe("#f87171");
  });
});

describe("edgeImpactStyle (unselected)", () => {
  test("returns the exact impact hex per type", () => {
    for (const impactType of impactTypes) {
      expect(edgeImpactStyle({ impactType, selected: false }).stroke).toBe(
        impactHexColors[impactType],
      );
    }
  });

  test("uses the per-impact base stroke width", () => {
    for (const impactType of impactTypes) {
      expect(edgeImpactStyle({ impactType, selected: false }).strokeWidth).toBe(
        impactStrokeWidths[impactType],
      );
    }
  });

  test("stroke width increases with impact severity", () => {
    const informational = edgeImpactStyle({
      impactType: "informational",
      selected: false,
    }).strokeWidth;
    const degraded = edgeImpactStyle({
      impactType: "degraded",
      selected: false,
    }).strokeWidth;
    const critical = edgeImpactStyle({
      impactType: "critical",
      selected: false,
    }).strokeWidth;
    expect(informational).toBeLessThan(degraded);
    expect(degraded).toBeLessThan(critical);
  });

  test("uses the per-impact opacity graduated to match the legend swatches", () => {
    for (const impactType of impactTypes) {
      expect(edgeImpactStyle({ impactType, selected: false }).opacity).toBe(
        impactStrokeOpacities[impactType],
      );
    }
  });

  test("opacity increases with impact severity (informational is faintest)", () => {
    const informational = edgeImpactStyle({
      impactType: "informational",
      selected: false,
    }).opacity;
    const degraded = edgeImpactStyle({
      impactType: "degraded",
      selected: false,
    }).opacity;
    const critical = edgeImpactStyle({
      impactType: "critical",
      selected: false,
    }).opacity;
    expect(informational).toBeLessThan(degraded);
    expect(degraded).toBeLessThan(critical);
  });
});

describe("edgeImpactStyle (selected)", () => {
  test("uses the primary color regardless of impact", () => {
    for (const impactType of impactTypes) {
      expect(edgeImpactStyle({ impactType, selected: true }).stroke).toBe(
        selectedEdgeStroke,
      );
    }
  });

  test("adds +1 to the base stroke width", () => {
    for (const impactType of impactTypes) {
      expect(edgeImpactStyle({ impactType, selected: true }).strokeWidth).toBe(
        impactStrokeWidths[impactType] + 1,
      );
    }
  });

  test("opacity is 1", () => {
    for (const impactType of impactTypes) {
      expect(edgeImpactStyle({ impactType, selected: true }).opacity).toBe(1);
    }
  });
});
