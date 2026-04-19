import { RESULT_BUFFER_CAPACITY } from "@checkstack/satellite-common";
import type { ResultMessage } from "@checkstack/satellite-common";

/**
 * In-memory FIFO ring buffer for health check results.
 * When the WebSocket connection is lost, results are queued here.
 * On reconnection, all buffered results are flushed to the core.
 * Oldest results are dropped when the buffer is full.
 */
export class ResultBuffer {
  private buffer: ResultMessage[] = [];
  private readonly capacity: number;

  constructor(capacity = RESULT_BUFFER_CAPACITY) {
    this.capacity = capacity;
  }

  /**
   * Push a result into the buffer.
   * If the buffer is full, the oldest result is dropped.
   */
  push(result: ResultMessage): void {
    if (this.buffer.length >= this.capacity) {
      // Drop oldest (FIFO)
      this.buffer.shift();
    }
    this.buffer.push(result);
  }

  /**
   * Flush all buffered results and clear the buffer.
   * Returns the results in chronological order (oldest first).
   */
  flush(): ResultMessage[] {
    const results = [...this.buffer];
    this.buffer = [];
    return results;
  }

  /** Current number of buffered results */
  get size(): number {
    return this.buffer.length;
  }

  /** Whether the buffer is empty */
  get isEmpty(): boolean {
    return this.buffer.length === 0;
  }
}
