import { describe, test, expect } from "bun:test";
import { isAccessRuleSatisfied } from "@checkstack/common";
import {
  dependencyAccess,
  dependencyAccessRules,
} from "@checkstack/dependency-common";

const QUALIFIED_MAP = "dependency.map.read";
const QUALIFIED_READ = "dependency.dependency.read";

describe("dependency-common access rules", () => {
  describe("dependency.map", () => {
    test("is its own resource/level with the dependency pluginId", () => {
      expect(dependencyAccess.map.id).toBe("map.read");
      expect(dependencyAccess.map.resource).toBe("map");
      expect(dependencyAccess.map.level).toBe("read");
      expect(dependencyAccess.map.pluginId).toBe("dependency");
    });

    test("is NOT public - anonymous users must not get the map by default", () => {
      expect(dependencyAccess.map.isPublic).toBeUndefined();
    });

    test("is granted to authenticated users by default", () => {
      expect(dependencyAccess.map.isDefault).toBe(true);
    });

    test("is registered so it syncs to roles", () => {
      expect(dependencyAccessRules).toContain(dependencyAccess.map);
    });

    test("the public read grant alone does NOT satisfy the map rule", () => {
      // A visitor who only has the public `dependency.read` (warnings) grant
      // must NOT be able to view the map - the map needs its own rule.
      expect(
        isAccessRuleSatisfied([QUALIFIED_READ], dependencyAccess.map),
      ).toBe(false);
    });

    test("the qualified map grant satisfies the map rule", () => {
      expect(isAccessRuleSatisfied([QUALIFIED_MAP], dependencyAccess.map)).toBe(
        true,
      );
    });
  });

  describe("dependency.read", () => {
    test("stays public so warning badges remain visible to anonymous users", () => {
      expect(dependencyAccess.dependency.read.isPublic).toBe(true);
    });

    test("is not satisfied by the map grant (the two are independent)", () => {
      expect(
        isAccessRuleSatisfied([QUALIFIED_MAP], dependencyAccess.dependency.read),
      ).toBe(false);
    });
  });
});
