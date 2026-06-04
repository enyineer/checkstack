/**
 * Contract test: every auth strategy registered via the
 * `betterAuthExtensionPoint.addStrategy` chokepoint MUST have a COMPLETE,
 * contiguous migration chain from version 1 to its current `configVersion`.
 *
 * Auth strategies do NOT use `Versioned`; they expose a bespoke shape
 * `{ configVersion, configSchema, migrations }` and the read path migrates-
 * then-validates via `configService.get(id, schema, configVersion, migrations)`.
 * A missing covering migration would therefore only surface LAZILY on the
 * first stale read. The boot guard wired into `addStrategy` (see
 * `index.ts`, `assertMigrationChainFromV1`) turns that into a registration-
 * time (boot) failure, and this test pins the contract:
 *
 *  - the structural guard accepts a representative strategy whose chain is
 *    complete (the happy path every concrete strategy must satisfy), and
 *  - the guard BITES on a deliberately-broken chain (so it can never be
 *    silently no-op'd).
 *
 * The concrete core strategies live in their own plugin packages
 * (`auth-github-backend`, `auth-ldap-backend`, `auth-saml-backend`,
 * `auth-credential-backend`) — auth-backend does not depend on them, so they
 * are guarded at THEIR registration via the same shared `addStrategy` boot
 * guard rather than re-enumerated here. This test owns the guard's contract;
 * a pure STRUCTURAL check (no `migrate()` runs), so it carries zero per-
 * strategy upkeep.
 */
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  assertMigrationChainFromV1,
  type AuthStrategy,
  type Migration,
} from "@checkstack/backend-api";

const passThrough = (fromVersion: number, toVersion: number): Migration => ({
  fromVersion,
  toVersion,
  description: `pass-through ${fromVersion}->${toVersion}`,
  migrate: (data) => data,
});

// Representative strategies mirroring the real shapes: a v1 no-migration
// strategy (like `credential`) and a v>1 strategy with a complete chain
// (like `ldap` at v3).
const v1Strategy: AuthStrategy<{ token: string }> = {
  id: "fixture-v1",
  displayName: "Fixture v1",
  configVersion: 1,
  configSchema: z.object({ token: z.string().default("") }),
  requiresManualRegistration: true,
};

const v3Strategy: AuthStrategy<{ host: string }> = {
  id: "fixture-v3",
  displayName: "Fixture v3",
  configVersion: 3,
  configSchema: z.object({ host: z.string().default("") }),
  requiresManualRegistration: false,
  migrations: [passThrough(1, 2), passThrough(2, 3)],
};

describe("auth strategy migration-chain contract", () => {
  it("the registration guard accepts strategies with a complete v1->version chain", () => {
    for (const strategy of [v1Strategy, v3Strategy]) {
      expect(
        () =>
          assertMigrationChainFromV1({
            version: strategy.configVersion,
            migrations: strategy.migrations ?? [],
          }),
        `Strategy "${strategy.id}" (configVersion ${strategy.configVersion}) should have a complete chain`,
      ).not.toThrow();
    }
  });

  it("the registration guard rejects a v>1 strategy missing its migrations", () => {
    const broken: AuthStrategy<{ host: string }> = {
      id: "fixture-broken-empty",
      displayName: "Fixture broken",
      configVersion: 3,
      configSchema: z.object({ host: z.string().default("") }),
      requiresManualRegistration: false,
    };
    expect(() =>
      assertMigrationChainFromV1({
        version: broken.configVersion,
        migrations: broken.migrations ?? [],
      }),
    ).toThrow(/incomplete/);
  });

  it("the registration guard rejects a gapped chain", () => {
    const gapped: AuthStrategy<{ host: string }> = {
      id: "fixture-broken-gap",
      displayName: "Fixture gapped",
      configVersion: 3,
      configSchema: z.object({ host: z.string().default("") }),
      requiresManualRegistration: false,
      migrations: [passThrough(1, 2)],
    };
    expect(() =>
      assertMigrationChainFromV1({
        version: gapped.configVersion,
        migrations: gapped.migrations ?? [],
      }),
    ).toThrow(/incomplete: reaches version 2/);
  });
});
