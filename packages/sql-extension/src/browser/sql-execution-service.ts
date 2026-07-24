/**
 * SQL Execution Service — executes SQL queries via the Runtime Agent API.
 * Handles query execution, cancellation, result parsing, and Oracle error handling.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { SqlConnectionService } from './sql-connection-service';

export interface SqlQueryResult {
  columns: SqlColumnDef[];
  rows: Record<string, unknown>[];
  rowCount: number;
  totalRows?: number;
  executionTimeMs: number;
  truncated: boolean;
}

export interface SqlColumnDef {
  name: string;
  type: string;
  label: string;
}

export interface SqlError {
  message: string;
  oracleErrorCode?: string;
  sqlState?: string;
  position?: number;
}

export interface SqlHistoryEntry {
  id: string;
  sql: string;
  connectionId: string;
  executedAt: string;
  executionTimeMs: number;
  success: boolean;
  error?: string;
  rowCount?: number;
}

export interface SqlExecuteRequest {
  connectionId: string;
  sql: string;
  maxRows?: number;
  timeoutMs?: number;
}

export interface SqlExecuteResponse {
  requestId: string;
  ok: boolean;
  payload?: {
    columns: SqlColumnDef[];
    rows: Record<string, unknown>[];
    rowCount: number;
    totalRows?: number;
    executionTimeMs: number;
    truncated: boolean;
  };
  error?: {
    code: string;
    message: string;
    details?: {
      oracleErrorCode?: string;
      sqlState?: string;
      position?: number;
    };
  };
}

const DEFAULT_MAX_ROWS = 10000;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_HISTORY = 50;

@injectable()
export class SqlExecutionService {
  @inject(SqlConnectionService)
  protected readonly connectionService!: SqlConnectionService;

  private history: SqlHistoryEntry[] = [];
  private abortControllers: Map<string, AbortController> = new Map();

  /** Execute a SQL statement. */
  async execute(request: SqlExecuteRequest): Promise<SqlQueryResult> {
    const maxRows = request.maxRows ?? DEFAULT_MAX_ROWS;
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const abortController = new AbortController();
    const requestId = `sql-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    this.abortControllers.set(requestId, abortController);

    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    const startTime = Date.now();

    try {
      const response = await fetch('/api/v1/sql/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          connectionId: request.connectionId,
          sql: request.sql,
          maxRows,
        }),
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);
      const executionTimeMs = Date.now() - startTime;

      const data: SqlExecuteResponse = await response.json();

      if (!response.ok || !data.ok) {
        const error: SqlError = {
          message: data.error?.message || `SQL execution failed with status ${response.status}`,
          oracleErrorCode: data.error?.details?.oracleErrorCode,
          sqlState: data.error?.details?.sqlState,
          position: data.error?.details?.position,
        };
        this.addHistory(request.connectionId, request.sql, executionTimeMs, false, error.message);
        throw this.formatOracleError(error);
      }

      const payload = data.payload!;
      const result: SqlQueryResult = {
        columns: payload.columns,
        rows: payload.rows,
        rowCount: payload.rowCount,
        totalRows: payload.totalRows,
        executionTimeMs,
        truncated: payload.truncated,
      };
      this.addHistory(request.connectionId, request.sql, executionTimeMs, true, undefined, payload.rowCount);
      return result;
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const executionTimeMs = Date.now() - startTime;

      if (err instanceof DOMException && err.name === 'AbortError') {
        const error: SqlError = {
          message: `Query timed out after ${timeoutMs}ms`,
        };
        this.addHistory(request.connectionId, request.sql, executionTimeMs, false, error.message);
        throw this.formatOracleError(error);
      }

      const message = err instanceof Error ? err.message : 'Unknown error';
      this.addHistory(request.connectionId, request.sql, executionTimeMs, false, message);
      throw err;
    } finally {
      this.abortControllers.delete(requestId);
    }
  }

  /** Cancel a running query. */
  cancelQuery(requestId: string): void {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
    }
  }

  /** Cancel all running queries. */
  cancelAll(): void {
    for (const [, controller] of this.abortControllers) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  /** Get statement history. */
  getHistory(connectionId?: string): SqlHistoryEntry[] {
    if (connectionId) {
      return this.history.filter((h) => h.connectionId === connectionId);
    }
    return [...this.history];
  }

  private addHistory(
    connectionId: string,
    sql: string,
    executionTimeMs: number,
    success: boolean,
    error?: string,
    rowCount?: number,
  ): void {
    const entry: SqlHistoryEntry = {
      id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      sql,
      connectionId,
      executedAt: new Date().toISOString(),
      executionTimeMs,
      success,
      error,
      rowCount,
    };
    this.history.unshift(entry);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(0, MAX_HISTORY);
    }
  }

  /** Format Oracle error messages to be user-friendly. */
  private formatOracleError(error: SqlError): Error {
    let message = error.message;
    if (error.oracleErrorCode) {
      message = `ORA-${error.oracleErrorCode}: ${message}`;
    }
    if (error.position) {
      message += ` (position: ${error.position})`;
    }
    return new Error(message);
  }

  /** Check if a SQL statement is dangerous. */
  isDangerousStatement(sql: string): { dangerous: boolean; reason?: string } {
    const upper = sql.trim().toUpperCase();
    // Check for DROP statements
    if (/\bDROP\s+(TABLE|VIEW|INDEX|DATABASE|SCHEMA|USER|PROCEDURE|FUNCTION|PACKAGE|TRIGGER|SEQUENCE|SYNONYM|TYPE)\b/i.test(upper)) {
      return { dangerous: true, reason: 'DROP statement detected' };
    }
    // Check for TRUNCATE
    if (/\bTRUNCATE\s+TABLE\b/i.test(upper)) {
      return { dangerous: true, reason: 'TRUNCATE statement detected' };
    }
    // Check for ALTER (DDL changes)
    if (/\bALTER\s+(TABLE|VIEW|INDEX|DATABASE|SYSTEM|SESSION|USER|PROFILE|ROLE|TABLESPACE)\b/i.test(upper)) {
      return { dangerous: true, reason: 'ALTER statement detected' };
    }
    // Check for DELETE without WHERE
    if (/\bDELETE\s+FROM\b/i.test(upper) && !/\bWHERE\b/i.test(upper)) {
      return { dangerous: true, reason: 'DELETE without WHERE clause' };
    }
    // Check for UPDATE without WHERE
    if (/\bUPDATE\s+\w+/i.test(upper) && !/\bWHERE\b/i.test(upper)) {
      return { dangerous: true, reason: 'UPDATE without WHERE clause' };
    }
    return { dangerous: false };
  }

  /** Extract the current statement from cursor position. */
  extractCurrentStatement(sql: string, cursorPosition: number): string {
    const statements = this.splitStatements(sql);
    let pos = 0;
    for (const stmt of statements) {
      const stmtEnd = pos + stmt.length;
      if (cursorPosition >= pos && cursorPosition <= stmtEnd) {
        return stmt.trim();
      }
      pos = stmtEnd + 1; // +1 for the semicolon
    }
    // Return the whole text if no statement found
    return sql.trim();
  }

  /** Split SQL text into individual statements. */
  splitStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let inBlockComment = false;
    let inLineComment = false;

    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i];
      const next = sql[i + 1] || '';

      if (inLineComment && ch === '\n') {
        inLineComment = false;
        current += ch;
        continue;
      }
      if (inLineComment) {
        current += ch;
        continue;
      }

      if (inBlockComment && ch === '*' && next === '/') {
        inBlockComment = false;
        current += '*/';
        i++;
        continue;
      }
      if (inBlockComment) {
        current += ch;
        continue;
      }

      if (ch === '-' && next === '-') {
        inLineComment = true;
        current += '--';
        i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        current += '/*';
        i++;
        continue;
      }

      if (inString) {
        current += ch;
        if (ch === stringChar && sql[i - 1] !== '\\') {
          inString = false;
        }
        continue;
      }

      if (ch === "'" || ch === '"') {
        inString = true;
        stringChar = ch;
        current += ch;
        continue;
      }

      if (ch === ';') {
        const trimmed = current.trim();
        if (trimmed) {
          statements.push(trimmed);
        }
        current = '';
      } else {
        current += ch;
      }
    }

    const trimmed = current.trim();
    if (trimmed) {
      statements.push(trimmed);
    }

    return statements;
  }

  /** Export results to CSV string. */
  exportToCsv(result: SqlQueryResult): string {
    const headers = result.columns.map((c) => this.escapeCsvField(c.label || c.name));
    const lines = [headers.join(',')];

    for (const row of result.rows) {
      const values = result.columns.map((c) => {
        const val = row[c.name];
        if (val === null || val === undefined) return '';
        return this.escapeCsvField(String(val));
      });
      lines.push(values.join(','));
    }

    return lines.join('\n');
  }

  /** Export results to JSON string. */
  exportToJson(result: SqlQueryResult): string {
    return JSON.stringify({
      columns: result.columns.map(c => ({ name: c.name, type: c.type })),
      rows: result.rows,
      rowCount: result.rowCount,
      totalRows: result.totalRows,
      executionTimeMs: result.executionTimeMs,
      truncated: result.truncated,
    }, null, 2);
  }

  /** Format SQL with basic indentation and keyword casing. */
  formatSql(sql: string): string {
    if (!sql || typeof sql !== 'string') return '';

    const upperKeywords = [
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
      'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'JOIN', 'LEFT',
      'RIGHT', 'INNER', 'OUTER', 'ON', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN',
      'LIKE', 'BETWEEN', 'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
      'AS', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'UNION', 'ALL',
      'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'ANY', 'SOME', 'TRUNCATE',
      'COMMIT', 'ROLLBACK', 'GRANT', 'REVOKE', 'BEGIN', 'DECLARE', 'EXCEPTION',
      'RAISE', 'PRAGMA', 'EXPLAIN', 'UNIQUE', 'PRIMARY', 'KEY', 'FOREIGN',
      'REFERENCES', 'CASCADE', 'DEFAULT', 'CHECK', 'CONSTRAINT', 'ADD', 'COLUMN',
      'RENAME', 'TO', 'IF', 'UNION ALL', 'CROSS', 'NATURAL', 'FULL', 'WITH',
      'RECURSIVE', 'RETURNING', 'OVER', 'PARTITION', 'ROWS', 'RANGE', 'UNBOUNDED',
      'PRECEDING', 'FOLLOWING', 'CURRENT', 'ROW', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
    ];

    // Normalize whitespace
    let formatted = sql.replace(/\s+/g, ' ').trim();

    // Uppercase SQL keywords
    const keywordPattern = new RegExp('\\b(' + upperKeywords.join('|') + ')\\b', 'gi');
    formatted = formatted.replace(keywordPattern, (match) => match.toUpperCase());

    // Add newlines before major clauses
    const majorClauses = ['SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'HAVING',
      'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'JOIN', 'LEFT JOIN',
      'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'FULL JOIN', 'CROSS JOIN',
      'UNION', 'UNION ALL', 'ON', 'LIMIT', 'OFFSET'];

    for (const clause of majorClauses) {
      const escaped = clause.replace(/\s+/g, '\\s+');
      const re = new RegExp('\\b(' + escaped + ')\\b', 'gi');
      formatted = formatted.replace(re, '\n$1');
    }

    // Indent the content after each newline
    const lines = formatted.split('\n');
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (i === 0) {
        result.push(line);
      } else {
        result.push('  ' + line);
      }
    }

    return result.join('\n');
  }

  private escapeCsvField(field: string): string {
    if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }
}