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
 * MySQL transport client for query execution.
 */
export type MysqlTransportClient = TransportClient<
  SqlQueryRequest,
  SqlQueryResult
>;
