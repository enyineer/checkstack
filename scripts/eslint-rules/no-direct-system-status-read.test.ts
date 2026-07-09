import { describe, it } from "bun:test";
import { RuleTester } from "eslint";

import { noDirectSystemStatusRead } from "./no-direct-system-status-read.mjs";

RuleTester.describe = (text, fn) => describe(text, fn);
RuleTester.it = (text, fn) => it(text, fn);
RuleTester.itOnly = (text, fn) => it(text, fn);

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const OPTS = [{ methods: ["getSystemHealthStatus"] }];

ruleTester.run("no-direct-system-status-read", noDirectSystemStatusRead, {
  valid: [
    // Reading through the cache facade is the sanctioned path.
    { code: `const s = await cache.read(systemId);`, options: OPTS },
    { code: `const s = await cache.readBulk(ids);`, options: OPTS },
    // A bare member access (no call) is fine: an oRPC handler definition's call
    // is `.handler(...)`, not `.getSystemHealthStatus(...)`.
    {
      code: `os.getSystemHealthStatus.handler(async () => cache.read(id));`,
      options: OPTS,
    },
    // An unrelated method call is untouched.
    { code: `service.getSystemEnvironmentIds(systemId);`, options: OPTS },
    // With no configured methods the rule is inert.
    { code: `service.getSystemHealthStatus(systemId);`, options: [{}] },
  ],
  invalid: [
    {
      code: `const s = await service.getSystemHealthStatus(systemId);`,
      options: OPTS,
      errors: [{ messageId: "directRead" }],
    },
    {
      code: `const s = await service.getSystemHealthStatus(systemId, envId);`,
      options: OPTS,
      errors: [{ messageId: "directRead" }],
    },
    // `this.`-scoped reads are also caught (the service file is exempted by
    // file scope in eslint.config.mjs, not by the rule).
    {
      code: `const s = await this.getSystemHealthStatus(systemId);`,
      options: OPTS,
      errors: [{ messageId: "directRead" }],
    },
  ],
});
