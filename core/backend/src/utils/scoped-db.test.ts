import { describe, it, expect, mock, beforeEach } from "bun:test";
import { entityKind } from "drizzle-orm";
import { createScopedDb } from "./scoped-db";

describe("createScopedDb", () => {
  const mockExecute = mock();
  const mockTransaction = mock();

  // Create a proper thenable mock that behaves like a Drizzle builder
  const createThenableMock = () => {
    const thenMock = mock();
    thenMock.mockImplementation(
      (
        onFulfilled?: (value: unknown[]) => unknown,
        _onRejected?: (reason: unknown) => unknown
      ) => {
        // Simulate async resolution like a real query
        if (onFulfilled) {
          return Promise.resolve(onFulfilled([]));
        }
        return Promise.resolve([]);
      }
    );
    return thenMock;
  };

  /**
   * Creates a mock builder with Drizzle's entityKind symbol.
   * This is required for the new entityKind-based detection to work.
   */
  const createMockBuilderClass = (kind: string) => {
    class MockBuilder {
      static [entityKind] = kind;
    }
    return MockBuilder;
  };

  let mockFromThen: ReturnType<typeof mock>;
  let mockFrom: ReturnType<typeof mock>;
  let mockSelectThen: ReturnType<typeof mock>;
  let mockSelect: ReturnType<typeof mock>;
  let mockValuesThen: ReturnType<typeof mock>;
  let mockValues: ReturnType<typeof mock>;
  let mockInsertThen: ReturnType<typeof mock>;
  let mockInsert: ReturnType<typeof mock>;
  let mockDb: {
    execute: ReturnType<typeof mock>;
    select: ReturnType<typeof mock>;
    insert: ReturnType<typeof mock>;
    transaction: ReturnType<typeof mock>;
  };

  // Helper to extract SQL string from the sql.raw call argument
  const getSqlString = (callArg: unknown): string => {
    // The search_path statement is now a templated `sql` with an escaped
    // identifier (`sql.identifier`), so its `queryChunks` are a mix of
    // StringChunks (literal text, `value` is a string[]) and a Name chunk for
    // the schema (`value` is a plain string). Flatten ALL chunk values so the
    // assertions see the full statement including the schema name.
    const arg = callArg as { queryChunks?: Array<{ value: unknown }> };
    if (arg?.queryChunks) {
      return arg.queryChunks
        .map((chunk) =>
          Array.isArray(chunk.value)
            ? chunk.value.join("")
            : String(chunk.value),
        )
        .join("");
    }
    return String(callArg);
  };

  /**
   * Creates a mock builder instance with the proper entityKind.
   * The instance needs to be an object whose constructor has the entityKind symbol.
   */
  const createMockBuilder = (
    kind: string,
    methods: Record<string, unknown>
  ): object => {
    const BuilderClass = createMockBuilderClass(kind);
    const instance = Object.create(BuilderClass.prototype);
    Object.assign(instance, methods);
    return instance;
  };

  beforeEach(() => {
    mockExecute.mockClear();
    mockExecute.mockResolvedValue({ rows: [] });
    mockTransaction.mockClear();

    // Set up fresh thenable mocks for each test
    mockFromThen = createThenableMock();
    // The result of .from() also needs entityKind - it returns a PgSelect
    const fromResult = createMockBuilder("PgSelect", {
      where: mock(),
      then: mockFromThen,
    });
    mockFrom = mock().mockReturnValue(fromResult);

    mockSelectThen = createThenableMock();
    // select() returns a PgSelectBuilder
    const selectResult = createMockBuilder("PgSelectBuilder", {
      from: mockFrom,
      then: mockSelectThen,
    });
    mockSelect = mock().mockReturnValue(selectResult);

    mockValuesThen = createThenableMock();
    // .values() returns a PgInsert
    const valuesResult = createMockBuilder("PgInsert", {
      then: mockValuesThen,
    });
    mockValues = mock().mockReturnValue(valuesResult);

    mockInsertThen = createThenableMock();
    // insert() returns a PgInsertBuilder
    const insertResult = createMockBuilder("PgInsertBuilder", {
      values: mockValues,
      then: mockInsertThen,
    });
    mockInsert = mock().mockReturnValue(insertResult);

    // Set up transaction mock to pass through to a callback with tx mock
    // The tx mock needs to have the same methods as the main db
    mockTransaction.mockImplementation(
      async (cb: (tx: typeof mockDb) => Promise<unknown>) => {
        // Create a tx mock that has the same structure
        const txMock = {
          execute: mockExecute,
          select: mockSelect,
          insert: mockInsert,
          transaction: mockTransaction,
        };
        return cb(txMock);
      }
    );

    mockDb = {
      execute: mockExecute,
      select: mockSelect,
      insert: mockInsert,
      transaction: mockTransaction,
    };
  });

  it("preserves chaining - select().from() works synchronously", () => {
    const scopedDb = createScopedDb(
      mockDb as unknown as Parameters<typeof createScopedDb>[0],
      "plugin_test"
    );

    // This should NOT throw - chaining must work synchronously
    scopedDb.select().from({} as unknown as Parameters<typeof mockFrom>[0]);

    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledTimes(1);
    // Transaction should NOT be called yet - only when query is awaited
    expect(mockTransaction).toHaveBeenCalledTimes(0);
  });

  it("sets search_path when select query is awaited (via .then())", async () => {
    const scopedDb = createScopedDb(
      mockDb as unknown as Parameters<typeof createScopedDb>[0],
      "plugin_test"
    );

    // When we await the query, .then() is called which triggers a transaction
    await scopedDb
      .select()
      .from({} as unknown as Parameters<typeof mockFrom>[0]);

    // Transaction should have been called to wrap the query
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // Execute should have been called to set search_path
    expect(mockExecute).toHaveBeenCalled();
    const sqlStr = getSqlString(mockExecute.mock.calls[0][0]);
    expect(sqlStr).toContain("SET LOCAL search_path");
    expect(sqlStr).toContain("plugin_test");
  });

  it("sets search_path before insert query is awaited", async () => {
    const scopedDb = createScopedDb(
      mockDb as unknown as Parameters<typeof createScopedDb>[0],
      "plugin_healthcheck"
    );

    await scopedDb
      .insert({} as unknown as Parameters<typeof mockInsert>[0])
      .values({});

    // Transaction should have been called
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalled();
    const sqlStr = getSqlString(mockExecute.mock.calls[0][0]);
    expect(sqlStr).toContain("plugin_healthcheck");
  });

  it("sets search_path once at transaction start", async () => {
    const scopedDb = createScopedDb(
      mockDb as unknown as Parameters<typeof createScopedDb>[0],
      "plugin_auth"
    );

    await scopedDb.transaction(async () => {
      // Transaction body
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledTimes(1); // Only once for SET LOCAL
    const sqlStr = getSqlString(mockExecute.mock.calls[0][0]);
    expect(sqlStr).toContain("plugin_auth");
  });

  it("sets search_path for direct execute() calls", async () => {
    const scopedDb = createScopedDb(
      mockDb as unknown as Parameters<typeof createScopedDb>[0],
      "plugin_direct"
    );

    await scopedDb.execute({} as unknown as Parameters<typeof mockExecute>[0]);

    // Transaction should have been used
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // First execute is SET LOCAL, second is the actual execute
    expect(mockExecute).toHaveBeenCalledTimes(2);
    const sqlStr = getSqlString(mockExecute.mock.calls[0][0]);
    expect(sqlStr).toContain("SET LOCAL search_path");
    expect(sqlStr).toContain("plugin_direct");
  });

  it("BLOCKS access to db.query (relational query API) to prevent schema bypass", () => {
    // Create a mock for db.query that returns a RelationalQueryBuilder
    const relationalQueryBuilder = createMockBuilder(
      "PgRelationalQueryBuilder",
      {
        findFirst: mock().mockReturnValue(
          createMockBuilder("PgRelationalQuery", {
            then: createThenableMock(),
          })
        ),
      }
    );
    const mockQuery = { users: relationalQueryBuilder };

    const dbWithQuery = {
      ...mockDb,
      query: mockQuery,
    };

    const scopedDb = createScopedDb(
      dbWithQuery as unknown as Parameters<typeof createScopedDb>[0],
      "plugin_test"
    );

    // Accessing db.query should throw an error because it would bypass
    // the schema isolation. Note: We use type assertion here since the type
    // system correctly excludes `query` - we're testing the runtime fallback.
    expect(() => (scopedDb as unknown as { query: unknown }).query).toThrow(
      /relational query API.*is not supported/i
    );
  });
});
