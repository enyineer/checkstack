/**
 * Integration test (real Postgres) for the catalog EntityService.
 *
 * These pin SQL whose CORRECTNESS is the risk, not its branch logic: the
 * case-insensitive `lower(name)` uniqueness lookup and the compound
 * `(id AND systemId)` scoping on contact/link deletion that stops a manager of
 * one system from deleting another system's child rows by passing a foreign id.
 * `createMockDb()` returns canned empty results and so cannot prove any of this;
 * only a real database can.
 *
 * Gated behind `CHECKSTACK_IT=1` (via `isIntegrationEnabled()`), so the default
 * `bun test` lane skips the whole suite. The `integration` CI job sets the flag
 * and provides a Postgres service container; the connection comes from
 * `CHECKSTACK_IT_PG_URL`. See `core/test-utils-backend/src/with-test-db.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  isIntegrationEnabled,
  withTestDb,
  type TestDb,
} from "@checkstack/test-utils-backend";
import * as schema from "../schema";
import { EntityService } from "./entity-service";

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "drizzle",
);

describe.skipIf(!isIntegrationEnabled())(
  "EntityService (real Postgres)",
  () => {
    let testDb: TestDb<typeof schema>;
    let service: EntityService;

    beforeAll(async () => {
      testDb = await withTestDb({ schema, migrationsFolder });
      service = new EntityService(testDb.db);
    });

    afterAll(async () => {
      await testDb.dispose();
    });

    describe("getSystemByName (case-insensitive uniqueness lookup)", () => {
      it("matches regardless of case so 'Api' collides with 'api'", async () => {
        await service.createSystem({ name: "Api" });

        const lower = await service.getSystemByName("api");
        const upper = await service.getSystemByName("API");
        const exact = await service.getSystemByName("Api");

        expect(lower?.name).toBe("Api");
        expect(upper?.name).toBe("Api");
        expect(exact?.name).toBe("Api");
      });

      it("returns undefined when the name is free", async () => {
        const result = await service.getSystemByName("definitely-unused-name");
        expect(result).toBeUndefined();
      });
    });

    describe("removeContact (compound id + systemId scoping)", () => {
      it("does not delete a contact when the systemId does not match", async () => {
        const owner = await service.createSystem({ name: "owner-sys" });
        const other = await service.createSystem({ name: "other-sys" });
        const contact = await service.addContact({
          systemId: owner.id,
          type: "mailbox",
          email: "oncall@example.test",
        });

        // Attacker passes the real contact id but a system they manage.
        const wrongScope = await service.removeContact({
          contactId: contact.id,
          systemId: other.id,
        });
        expect(wrongScope).toBeUndefined();

        // The contact still exists under its real owner.
        const stillThere = await service.getContactsForSystem(owner.id);
        expect(stillThere.map((c) => c.id)).toContain(contact.id);

        // Correct scope deletes it and returns the removed row.
        const removed = await service.removeContact({
          contactId: contact.id,
          systemId: owner.id,
        });
        expect(removed?.id).toBe(contact.id);

        const afterDelete = await service.getContactsForSystem(owner.id);
        expect(afterDelete.map((c) => c.id)).not.toContain(contact.id);
      });
    });

    describe("removeLink (compound id + systemId scoping)", () => {
      it("does not delete a link when the systemId does not match", async () => {
        const owner = await service.createSystem({ name: "link-owner-sys" });
        const other = await service.createSystem({ name: "link-other-sys" });
        const link = await service.addLink({
          systemId: owner.id,
          label: "Runbook",
          url: "https://runbook.example.test",
        });

        const wrongScope = await service.removeLink({
          linkId: link.id,
          systemId: other.id,
        });
        expect(wrongScope).toBeUndefined();

        const stillThere = await service.getLinksForSystem(owner.id);
        expect(stillThere.map((l) => l.id)).toContain(link.id);

        const removed = await service.removeLink({
          linkId: link.id,
          systemId: owner.id,
        });
        expect(removed?.id).toBe(link.id);

        const afterDelete = await service.getLinksForSystem(owner.id);
        expect(afterDelete.map((l) => l.id)).not.toContain(link.id);
      });
    });
  },
);
