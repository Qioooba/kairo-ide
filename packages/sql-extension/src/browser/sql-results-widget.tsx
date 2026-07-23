/**
 * SQL Results Widget — displays query results with virtual scrolling,
 * column sorting, row count, execution time, and CSV export.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import * as React from '@theia/core/shared/react';
import { SqlQueryResult, SqlColumnDef, SqlExecutionService } from './sql-execution-service';

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
    this.title.caption = 'SQL Query Results';
    this.title.closable = true;
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
        <div className="sql-results-widget">
          <div className="sql-results-error">
            <h4>Execution Error</h4>
            <pre>{error}</pre>
          </div>
        </div>
      );
    }

    if (!result) {
      return (
        <div className="sql-results-widget">
          <div className="sql-empty-message">Execute a SQL statement to see results here.</div>
        </div>
      );
    }

    const sortedRows = this.getSortedRows(result);
    const totalPages = Math.ceil(sortedRows.length / pageSize);
    const pageRows = sortedRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

    return (
      <div className="sql-results-widget">
        <div className="sql-results-header">
          <span className="sql-results-count">
            {result.rowCount} row{result.rowCount !== 1 ? 's' : ''}
            {result.truncated && ` (truncated, ${result.totalRows || '?'} total)`}
          </span>
          <span className="sql-results-time">
            {result.executionTimeMs}ms
          </span>
          <button
            className="theia-button"
            onClick={() => this.handleExportCsv()}
          >
            Export CSV
          </button>
          {result.truncated && (
            <span className="sql-results-warning">Results truncated. Refine your query to see more rows.</span>
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
        title={`${col.label} (${col.type})`}
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
          Previous
        </button>
        <span className="sql-results-page-info">
          Page {currentPage + 1} of {totalPages}
          {' '}({(currentPage * this.state.pageSize) + 1}-{Math.min((currentPage + 1) * this.state.pageSize, result.rowCount)} of {result.rowCount} rows)
        </span>
        <button
          className="theia-button"
          disabled={currentPage >= totalPages - 1}
          onClick={() => this.setState({ currentPage: currentPage + 1 })}
        >
          Next
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
      return '<NULL>';
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
    a.download = `sql-results-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private setState(partial: Partial<ResultsWidgetState>): void {
    this.state = { ...this.state, ...partial };
    this.update();
  }
}