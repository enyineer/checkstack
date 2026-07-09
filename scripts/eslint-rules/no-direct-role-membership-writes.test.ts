import { describe, it } from "bun:test";
import { RuleTester } from "eslint";

import { noDirectRoleMembershipWrites } from "./no-direct-role-membership-writes.mjs";

// Drive ESLint's RuleTester through bun:test's describe/it so failures surface
// as normal test cases (RuleTester calls these statics internally).
RuleTester.describe = (text, fn) => describe(text, fn);
RuleTester.it = (text, fn) => it(text, fn);
RuleTester.itOnly = (text, fn) => it(text, fn);

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const OPTS = [{ tables: ["role", "roleAccessRule", "userRole"] }];

ruleTester.run("no-direct-role-membership-writes", noDirectRoleMembershipWrites, {
  valid: [
    // Reads are untouched: `.select().from(schema.userRole)` is not a write.
    {
      code: `db.select().from(schema.userRole).where(eq(schema.userRole.userId, id));`,
      options: OPTS,
    },
    // Writes to NON-protected tables are fine.
    {
      code: `db.insert(schema.session).values(row); tx.delete(schema.accessRule).where(c);`,
      options: OPTS,
    },
    // `.delete()` on a Map/other object (not a protected table arg) is fine.
    {
      code: `myMap.delete(userId); set.delete(roleId);`,
      options: OPTS,
    },
    // With no configured tables the rule is inert.
    {
      code: `db.insert(schema.userRole).values(row);`,
      options: [{}],
    },
  ],
  invalid: [
    {
      code: `await db.insert(schema.userRole).values({ userId, roleId });`,
      options: OPTS,
      errors: [{ messageId: "directWrite" }],
    },
    {
      code: `await tx.delete(schema.roleAccessRule).where(eq(schema.roleAccessRule.roleId, id));`,
      options: OPTS,
      errors: [{ messageId: "directWrite" }],
    },
    {
      code: `await db.update(schema.role).set({ name }).where(eq(schema.role.id, id));`,
      options: OPTS,
      errors: [{ messageId: "directWrite" }],
    },
    // A bare (destructured-import) table identifier is also caught.
    {
      code: `await db.insert(userRole).values(row);`,
      options: OPTS,
      errors: [{ messageId: "directWrite" }],
    },
  ],
});
