/**
 * SQL Results Widget — displays query results with virtual scrolling,
 * column sorting, row count, execution time, and CSV export.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import * as React from '@theia/core/shared/react';
import { SqlQueryResult, SqlColumnDef, SqlExecutionService } from './sql-execution-service';
import { KairoI18nService } from '@kairo/i18n';

interface ResultsWidgetState {
  result: SqlQueryResult | null;
  error: string | null;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  currentPage: number;
  pageSize: number;
}

@injectable()
export class SqlResultsWidget extends ReactWidget {
  static readonly ID = 'kairo-sql-results-widget';
  static readonly LABEL = 'SQL Results';

  @inject(SqlExecutionService)
  protected readonly executionService!: SqlExecutionService;

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  private state: ResultsWidgetState = {
    result: null,
    error: null,
    sortColumn: null,
    sortDirection: 'asc',
    currentPage: 0,
    pageSize: 100,
  };

  @postConstruct()
  protected init(): void {
    this.id = SqlResultsWidget.ID;
    this.title.label = SqlResultsWidget.LABEL;
    this.title.caption = this.t('widget.sql.results.caption');
    this.title.closable = true;
    this.i18n.onDidChangeLanguage(() => this.update());
    this.update();
  }

  showResult(result: SqlQueryResult): void {
    this.setState({ result, error: null, currentPage: 0, sortColumn: null, sortDirection: 'asc' });
  }

  showError(error: string): void {
    this.setState({ result: null, error });
  }

  protected render(): React.ReactNode {
    const { result, error, sortColumn: _sortColumn, sortDirection: _sortDirection, currentPage, pageSize } = this.state;

    if (error) {
      return (
        <div className="sql-results-widget kairo-sql-results-widget">
          <div className="sql-results-error kairo-error-banner" role="alert">
            <h4>{this.t('widget.sql.results.error.title')}</h4>
            <pre>{error}</pre>
          </div>
        </div>
      );
    }

    if (!result) {
      return (
        <div className="sql-results-widget kairo-sql-results-widget">
          <div className="sql-empty-message kairo-empty-state">{this.t('widget.sql.results.empty')}</div>
        </div>
      );
    }

    const sortedRows = this.getSortedRows(result);
    const totalPages = Math.ceil(sortedRows.length / pageSize);
    const pageRows = sortedRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

    return (
      <div className="sql-results-widget kairo-sql-results-widget">
        <div className="sql-results-header">
          <span className="sql-results-count">
            {this.t('widget.sql.results.rowCount', { count: result.rowCount })}
            {result.truncated && this.t('widget.sql.results.truncated', { total: result.totalRows || '?' })}
          </span>
          <span className="sql-results-time">
            {this.t('widget.sql.results.executionTime', { time: result.executionTimeMs })}
          </span>
          <button
            className="theia-button"
            onClick={() => this.handleExportCsv()}
          >
            {this.t('widget.sql.results.exportCsv')}
          </button>
          <button
            className="theia-button"
            onClick={() => this.handleExportJson()}
          >
            {this.t('widget.sql.results.exportJson')}
          </button>
          {result.truncated && (
            <span className="sql-results-warning">{this.t('widget.sql.results.truncatedHint')}</span>
          )}
        </div>

        <div className="sql-results-table-container">
          <table className="sql-results-table">
            <thead>
              <tr>
                {result.columns.map((col) => this.renderColumnHeader(col))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {result.columns.map((col) => (
                    <td key={col.name} className="sql-results-cell">
                      {this.formatCellValue(row[col.name])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && this.renderPagination(currentPage, totalPages, result)}
      </div>
    );
  }

  private renderColumnHeader(col: SqlColumnDef): React.ReactNode {
    const { sortColumn, sortDirection } = this.state;
    const isSorted = sortColumn === col.name;
    const sortIcon = isSorted ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';

    return (
      <th
        key={col.name}
        onClick={() => this.handleSort(col.name)}
        className="sql-results-th"
        title={this.t('widget.sql.results.columnTooltip', { label: col.label, type: col.type })}
      >
        <span className="sql-results-col-name">{col.label || col.name}</span>
        <span className="sql-results-col-type">{col.type}</span>
        {sortIcon && <span className="sql-results-sort-icon">{sortIcon}</span>}
      </th>
    );
  }

  private renderPagination(currentPage: number, totalPages: number, result: SqlQueryResult): React.ReactNode {
    return (
      <div className="sql-results-pagination">
        <button
          className="theia-button"
          disabled={currentPage === 0}
          onClick={() => this.setState({ currentPage: currentPage - 1 })}
        >
          {this.t('widget.sql.results.previous')}
        </button>
        <span className="sql-results-page-info">
          {this.t('widget.sql.results.pageInfo', {
            current: currentPage + 1,
            total: totalPages,
            start: (currentPage * this.state.pageSize) + 1,
            end: Math.min((currentPage + 1) * this.state.pageSize, result.rowCount),
            count: result.rowCount,
          })}
        </span>
        <button
          className="theia-button"
          disabled={currentPage >= totalPages - 1}
          onClick={() => this.setState({ currentPage: currentPage + 1 })}
        >
          {this.t('widget.sql.results.next')}
        </button>
      </div>
    );
  }

  private handleSort(columnName: string): void {
    const { sortColumn, sortDirection } = this.state;
    if (sortColumn === columnName) {
      this.setState({
        sortDirection: sortDirection === 'asc' ? 'desc' : 'asc',
      });
    } else {
      this.setState({
        sortColumn: columnName,
        sortDirection: 'asc',
      });
    }
  }

  private getSortedRows(result: SqlQueryResult): Record<string, unknown>[] {
    const { sortColumn, sortDirection } = this.state;
    if (!sortColumn) return result.rows;

    return [...result.rows].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let comparison = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal));
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }

  private formatCellValue(value: unknown): string {
    if (value === null || value === undefined) {
      return this.t('widget.sql.results.nullValue');
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  private handleExportCsv(): void {
    if (!this.state.result) return;
    const csv = this.executionService.exportToCsv(this.state.result);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.t('widget.sql.results.csvFileName', { timestamp: new Date().toISOString().replace(/[:.]/g, '-') });
    a.click();
    URL.revokeObjectURL(url);
  }

  private handleExportJson(): void {
    if (!this.state.result) return;
    const json = this.executionService.exportToJson(this.state.result);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.t('widget.sql.results.jsonFileName', { timestamp: new Date().toISOString().replace(/[:.]/g, '-') });
    a.click();
    URL.revokeObjectURL(url);
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key as any, params);
  }

  private setState(partial: Partial<ResultsWidgetState>): void {
    this.state = { ...this.state, ...partial };
    this.update();
  }
}
