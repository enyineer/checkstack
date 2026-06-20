import { describe, test, expect } from "bun:test";
import { Server } from "lucide-react";
import {
  registerSubjectKind,
  getSubjectKindRenderer,
} from "./SubjectKindRegistry";

describe("SubjectKindRegistry", () => {
  test("returns the generic fallback renderer for an unregistered kind", () => {
    const renderer = getSubjectKindRenderer("never-registered.kind");
    expect(renderer.label).toBe("Subject");
    // a fallback icon is always provided.
    expect(renderer.icon).toBeDefined();
  });

  test("resolves a registered kind to its renderer", () => {
    registerSubjectKind("catalog.system", { label: "System", icon: Server });
    const renderer = getSubjectKindRenderer("catalog.system");
    expect(renderer.label).toBe("System");
    expect(renderer.icon).toBe(Server);
  });

  test("re-registering the same kind overwrites the prior renderer (idempotent)", () => {
    registerSubjectKind("test.kind", { label: "First", icon: Server });
    registerSubjectKind("test.kind", { label: "Second", icon: Server });
    expect(getSubjectKindRenderer("test.kind").label).toBe("Second");
  });

  test("an unknown kind still falls back after others are registered", () => {
    registerSubjectKind("a.b", { label: "AB", icon: Server });
    expect(getSubjectKindRenderer("c.d").label).toBe("Subject");
  });
});
