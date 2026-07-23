/**
 * Kairo SQL Service — client for the Go Agent SQL API endpoints.
 *
 * Communicates with the Runtime Agent at http://localhost:17890
 * to test database connections and execute SQL queries.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';

export const SQL_AGENT_BASE = 'http://localhost:17890/api/v1/sql';

/** SQL keywords that are rejected when preceded by `;` — basic SQL injection guard. */
const DANGEROUS_KEYWORDS = /\b(DROP|DELETE|TRUNCATE|ALTER|CREATE)\b/i;

/** Fetch timeout (ms). */
const FETCH_TIMEOUT_MS = 30_000;

/** Max retry count for transient errors. */
const MAX_RETRIES = 2;

/** Delay between retries (ms). */
const RETRY_DELAY_MS = 1_000;

export interface SqlConnectionConfig {
  host: string;
  port: number;
  sid?: string;
  serviceName?: string;
  useServiceName: boolean;
  username: string;
  password: string;
}

export interface SqlQueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
  error?: string;
}

@injectable()
export class KairoSqlService {
  @inject(ILogger) protected readonly logger!: ILogger;

  /** Test a database connection configuration. */
  async testConnection(config: SqlConnectionConfig): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.fetchWithTimeout(`${SQL_AGENT_BASE}/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await response.json();
      if (!response.ok) {
        const msg = `HTTP ${response.status}: ${data.error || data.message || 'Unknown error'}`;
        this.logger.error(`[SQL] testConnection failed: ${msg}`);
        return { success: false, message: msg };
      }
      return { success: data.success ?? true, message: data.message ?? 'Connection successful' };
    } catch (err) {
      const msg = this.formatError(err);
      this.logger.error(`[SQL] testConnection error: ${msg}`);
      return { success: false, message: msg };
    }
  }

  /** Execute a SQL query against a connected database. */
  async executeQuery(connectionId: string, sql: string, maxRows?: number): Promise<SqlQueryResult> {
    // Basic SQL injection guard: reject multi-statement queries with dangerous keywords
    const validationError = this.validateSql(sql);
    if (validationError) {
      this.logger.error(`[SQL] executeQuery rejected: ${validationError}`);
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTime: 0,
        error: `Query rejected: ${validationError}`,
      };
    }

    return this.executeWithRetry(connectionId, sql, maxRows);
  }

  /* ------------------------------------------------------------------ */
  /*  Internal                                                            */
  /* ------------------------------------------------------------------ */

  /** Validate SQL query for basic injection patterns. */
  protected validateSql(sql: string): string | undefined {
    if (!sql || typeof sql !== 'string') {
      return 'Empty SQL query';
    }
    const trimmed = sql.trim();
    if (trimmed.length === 0) {
      return 'Empty SQL query';
    }
    // Check for multi-statement with dangerous SQL keywords
    const statementParts = trimmed.split(';').filter(s => s.trim().length > 0);
    if (statementParts.length > 1) {
      for (let i = 1; i < statementParts.length; i++) {
        if (DANGEROUS_KEYWORDS.test(statementParts[i])) {
          return 'Multi-statement query with dangerous SQL keywords (DROP/DELETE/TRUNCATE/ALTER/CREATE) is not allowed';
        }
      }
    }
    return undefined;
  }

  /** Execute with retry logic for transient errors. */
  protected async executeWithRetry(connectionId: string, sql: string, maxRows?: number): Promise<SqlQueryResult> {
    let lastError: SqlQueryResult | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        this.logger.info(`[SQL] Retry attempt ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY_MS}ms`);
        await this.delay(RETRY_DELAY_MS);
      }

      try {
        const response = await this.fetchWithTimeout(`${SQL_AGENT_BASE}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, sql, maxRows }),
        });
        const data = await response.json();
        if (!response.ok) {
          const errorMsg = `HTTP ${response.status}: ${data.error || data.message || 'Unknown error'}`;
          const result: SqlQueryResult = {
            columns: [],
            rows: [],
            rowCount: 0,
            executionTime: 0,
            error: errorMsg,
          };
          // Only retry on server errors (5xx), not client errors (4xx)
          if (response.status >= 500) {
            lastError = result;
            this.logger.warn(`[SQL] Server error (attempt ${attempt + 1}): ${errorMsg}`);
            continue;
          }
          this.logger.error(`[SQL] Client error: ${errorMsg}`);
          return result;
        }

        // Sanitize rows: convert null values to 'NULL' string
        const rows = (data.rows ?? []).map((row: any[]) =>
          (row ?? []).map((cell: any) => (cell === null || cell === undefined ? 'NULL' : cell)),
        );

        return {
          columns: data.columns ?? [],
          rows,
          rowCount: data.rowCount ?? rows.length,
          executionTime: data.executionTime ?? 0,
          error: data.error,
        };
      } catch (err) {
        const msg = this.formatError(err);
        lastError = {
          columns: [],
          rows: [],
          rowCount: 0,
          executionTime: 0,
          error: msg,
        };
        if (this.isTransientError(err)) {
          this.logger.warn(`[SQL] Transient error (attempt ${attempt + 1}): ${msg}`);
          continue;
        }
        this.logger.error(`[SQL] Non-transient error: ${msg}`);
        return lastError;
      }
    }

    return lastError!;
  }

  /** Fetch with a configurable timeout using AbortController. */
  protected async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Check if an error is transient (network/timeout) and should be retried. */
  protected isTransientError(err: unknown): boolean {
    if (err instanceof TypeError) {
      // Network failures (fetch failed, DNS, etc.)
      return true;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      // Timeout
      return true;
    }
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes('timeout') || msg.includes('network') || msg.includes('econnrefused');
  }

  /** Format an error into a human-readable message. */
  protected formatError(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }

  /** Delay helper. */
  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}