import { mock } from "bun:test";

/**
 * Creates a mock Drizzle database instance suitable for unit testing.
 * This mock supports the most common query patterns:
 * - select().from()
 * - select().from().where()
 * - select().from().where().limit()
 * - insert().values()
 * - insert().values().onConflictDoUpdate()
 * - update().set().where()
 *
 * @returns A mock database object that can be used in place of a real Drizzle database
 *
 * @example
 * ```typescript
 * const mockDb = createMockDb();
 * const service = new MyService(mockDb);
 * ```
 */
export function createMockDb() {
  const createSelectChain = () => {
    const whereResult = Object.assign(Promise.resolve([]), {
      limit: mock(() => Promise.resolve([])),
      orderBy: mock(function () {
        return Object.assign(Promise.resolve([]), {
          limit: mock(() => Promise.resolve([])),
        });
      }),
    });
    const innerJoinResult = Object.assign(Promise.resolve([]), {
      where: mock(() => whereResult),
      leftJoin: mock(function () {
        return Object.assign(Promise.resolve([]), {
          where: mock(() => whereResult),
        });
      }),
    });
    const fromResult = Object.assign(Promise.resolve([]), {
      where: mock(() => whereResult),
      innerJoin: mock(() => innerJoinResult),
      leftJoin: mock(() => innerJoinResult),
      groupBy: mock(function () {
        return Object.assign(Promise.resolve([]), {
          as: mock(() => ({})), // For subquery aliasing
        });
      }),
    });
    return {
      from: mock(() => fromResult),
    };
  };

  return {
    select: mock(() => createSelectChain()),
    insert: mock(() => ({
      values: mock(() => ({
        onConflictDoUpdate: mock(() => Promise.resolve()),
        returning: mock(() => Promise.resolve([])),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => Promise.resolve()),
        returning: mock(() => Promise.resolve([])),
      })),
    })),
    delete: mock(() => ({
      where: mock(() => Promise.resolve()),
    })),
    execute: mock(() => Promise.resolve()),
  };
}

/**
 * Creates a mock database module export suitable for use with Bun's mock.module().
 * This includes both the database instance and the admin pool.
 *
 * @returns An object with adminPool and db properties
 *
 * @example
 * ```typescript
 * mock.module("./db", () => createMockDbModule());
 * ```
 */
export function createMockDbModule() {
  return {
    adminPool: { query: mock(() => Promise.resolve()) },
    db: createMockDb(),
  };
}
