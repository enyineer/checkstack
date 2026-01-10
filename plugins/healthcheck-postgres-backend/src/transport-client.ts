import type { TransportClient } from "@checkstack/common";

/**
 * SQL query request.
 */
export interface SqlQueryRequest {
  query: string;
}

/**
 * SQL query result.
 */
export interface SqlQueryResult {
  rowCount: number;
  error?: string;
}

/**
 * PostgreSQL transport client for query execution.
 */
export type PostgresTransportClient = TransportClient<
  SqlQueryRequest,
  SqlQueryResult
>;
