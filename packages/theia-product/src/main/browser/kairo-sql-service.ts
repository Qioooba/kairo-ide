/**
 * Kairo SQL Service — client for the Go Agent SQL API endpoints.
 *
 * Routes through RuntimeConnectionService (agent URL + secret + envelope).
 * Do not use hardcoded localhost or naked fetch.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core/lib/common/logger';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';

/** SQL keywords that are rejected when preceded by `;` — basic SQL injection guard. */
const DANGEROUS_KEYWORDS = /\b(DROP|DELETE|TRUNCATE|ALTER|CREATE)\b/i;

/** Request timeout (ms). */
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
  rows: unknown[][];
  rowCount: number;
  executionTime: number;
  error?: string;
}

@injectable()
export class KairoSqlService {
  @inject(ILogger) protected readonly logger!: ILogger;
  @inject(RuntimeConnectionService) protected readonly runtime!: RuntimeConnectionService;

  /** Test a database connection configuration. */
  async testConnection(config: SqlConnectionConfig): Promise<{ success: boolean; message: string }> {
    try {
      const data = await this.runtime.request(
        'POST /api/v1/sql/test-connection',
        config,
        { timeoutMs: FETCH_TIMEOUT_MS },
      );
      return {
        success: Boolean((data as { success?: boolean }).success ?? true),
        message: String((data as { message?: string }).message ?? 'Connection successful'),
      };
    } catch (err) {
      const msg = this.formatError(err);
      this.logger.error(`[SQL] testConnection error: ${msg}`);
      return { success: false, message: msg };
    }
  }

  /** Execute a SQL query against a connected database. */
  async executeQuery(connectionId: string, sql: string, maxRows?: number): Promise<SqlQueryResult> {
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

  protected validateSql(sql: string): string | undefined {
    if (!sql || typeof sql !== 'string') {
      return 'Empty SQL query';
    }
    const trimmed = sql.trim();
    if (trimmed.length === 0) {
      return 'Empty SQL query';
    }
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

  protected async executeWithRetry(connectionId: string, sql: string, maxRows?: number): Promise<SqlQueryResult> {
    let lastError: SqlQueryResult | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        this.logger.info(`[SQL] Retry attempt ${attempt}/${MAX_RETRIES} after ${RETRY_DELAY_MS}ms`);
        await this.delay(RETRY_DELAY_MS);
      }

      try {
        const data = await this.runtime.request('POST /api/v1/sql/execute', {
          connectionId,
          sql,
          maxRows,
        }, {
          timeoutMs: FETCH_TIMEOUT_MS,
          noRetry: true,
        });

        const payload = data as unknown as {
          columns?: Array<{ name: string } | string>;
          rows?: unknown[][] | Array<Record<string, unknown>>;
          rowCount?: number;
          executionTime?: number;
          executionTimeMs?: number;
          error?: string;
        };

        const columns = (payload.columns ?? []).map(c =>
          typeof c === 'string' ? c : c.name,
        );
        const rawRows = payload.rows ?? [];
        const rows: unknown[][] = rawRows.map(row => {
          if (Array.isArray(row)) {
            return row.map(cell => (cell === null || cell === undefined ? 'NULL' : cell));
          }
          return columns.map(name => {
            const cell = (row as Record<string, unknown>)[name];
            return cell === null || cell === undefined ? 'NULL' : cell;
          });
        });

        return {
          columns,
          rows,
          rowCount: payload.rowCount ?? rows.length,
          executionTime: payload.executionTime ?? payload.executionTimeMs ?? 0,
          error: payload.error,
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
        // Don't retry clear unsupported / client errors.
        if (err instanceof KairoError && (err.code === 'unsupported' || err.code === 'invalid_request')) {
          this.logger.error(`[SQL] Non-retryable: ${msg}`);
          return lastError;
        }
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

  protected isTransientError(err: unknown): boolean {
    if (err instanceof TypeError) {
      return true;
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      return true;
    }
    if (err instanceof KairoError) {
      return err.code === 'timeout' || err.code === 'io_error' || err.code === 'process_spawn_failed';
    }
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes('timeout') || msg.includes('network') || msg.includes('econnrefused');
  }

  protected formatError(err: unknown): string {
    if (err instanceof KairoError) {
      return err.message || err.code;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }

  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
