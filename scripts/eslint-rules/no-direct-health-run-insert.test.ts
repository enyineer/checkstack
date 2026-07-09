import { describe, it } from "bun:test";
import { RuleTester } from "eslint";

import { noDirectHealthRunInsert } from "./no-direct-health-run-insert.mjs";

RuleTester.describe = (text, fn) => describe(text, fn);
RuleTester.it = (text, fn) => it(text, fn);
RuleTester.itOnly = (text, fn) => it(text, fn);

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const OPTS = [{ tables: ["healthCheckRuns"] }];

ruleTester.run("no-direct-health-run-insert", noDirectHealthRunInsert, {
  valid: [
    // The read path is untouched (`from`, not `insert`).
    {
      code: `db.select().from(schema.healthCheckRuns).where(c);`,
      options: OPTS,
    },
    // Inserts to a NON-protected table are fine.
    { code: `db.insert(schema.healthCheckConfigurations).values(row);`, options: OPTS },
    // `.insert` on a non-table arg is fine.
    { code: `map.insert(key, value);`, options: OPTS },
    // With no configured tables the rule is inert.
    { code: `tx.insert(schema.healthCheckRuns).values(row);`, options: [{}] },
  ],
  invalid: [
    {
      code: `await tx.insert(schema.healthCheckRuns).values({ systemId });`,
      options: OPTS,
      errors: [{ messageId: "directInsert" }],
    },
    // A bare (destructured-import) table identifier is also caught.
    {
      code: `await db.insert(healthCheckRuns).values(row);`,
      options: OPTS,
      errors: [{ messageId: "directInsert" }],
    },
  ],
});
