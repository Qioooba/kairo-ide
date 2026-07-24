import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { GitService, GitCommit } from './git-service';
import { GitCommitSearch, CommitSearchCriteria, CommitSearchResult, CommitSearchSummary } from './git-commit-search';
import { GitCherryPickService } from './git-cherrypick-service';

@injectable()
export class GitHistoryWidget extends ReactWidget {
  static readonly ID = 'kairo-git-history';
  static readonly LABEL = 'Git History';

  @inject(GitService) protected gitService!: GitService;
  @inject(GitCommitSearch) protected commitSearch!: GitCommitSearch;
  @inject(GitCherryPickService) protected cherryPickService!: GitCherryPickService;

  protected commits: GitCommit[] = [];
  protected selectedCommit: GitCommit | undefined;
  protected loading = true;

  // Search state
  protected searchQuery = '';
  protected searchResults: CommitSearchResult[] = [];
  protected searchSummary: CommitSearchSummary = { status: 'idle', results: [], query: '', totalCount: 0 };
  protected isSearching = false;

  @postConstruct()
  protected init(): void {
    this.id = GitHistoryWidget.ID;
    this.title.label = GitHistoryWidget.LABEL;
    this.title.caption = 'Git Commit History';
    this.title.closable = true;
    this.update();
  }

  protected onAfterShow(): void {
    this.loadHistory();
  }

  protected async loadHistory(): Promise<void> {
    this.loading = true;
    this.update();
    this.commits = await this.gitService.getHistory(50);
    this.loading = false;
    this.update();
  }

  protected selectCommit = async (commit: GitCommit): Promise<void> => {
    this.selectedCommit = commit;
    this.update();
  };

  protected handleCherryPick = async (commit: GitCommit, event: React.MouseEvent): Promise<void> => {
    event.stopPropagation();
    try {
      await this.cherryPickService.cherryPickSingle(commit.hash);
    } catch {
      // Cherry-pick conflict or error handled by the service
    }
  };

  protected handleSearch = async (query: string): Promise<void> => {
    this.searchQuery = query;
    if (!query.trim()) {
      this.searchResults = [];
      this.searchSummary = { status: 'idle', results: [], query: '', totalCount: 0 };
      this.isSearching = false;
      this.update();
      return;
    }

    this.isSearching = true;
    this.update();

    const criteria = this.parseSearchQuery(query);
    this.searchSummary = await this.commitSearch.search(criteria);
    this.searchResults = this.searchSummary.results;
    this.isSearching = false;
    this.update();
  };

  protected parseSearchQuery(query: string): CommitSearchCriteria {
    const criteria: CommitSearchCriteria = {};

    // Check for author: prefix
    const authorMatch = query.match(/author:([^\s]+)/i);
    if (authorMatch) {
      criteria.author = authorMatch[1];
    }

    // Check for path: prefix
    const pathMatch = query.match(/path:([^\s]+)/i);
    if (pathMatch) {
      criteria.filePath = pathMatch[1];
    }

    // Check for SHA-like prefix (7+ hex chars)
    const shaMatch = query.match(/^([a-f0-9]{7,40})$/i);
    if (shaMatch) {
      criteria.shaPrefix = shaMatch[1];
    }

    // Check for date range
    const dateFromMatch = query.match(/after:([^\s]+)/i);
    if (dateFromMatch) {
      criteria.dateFrom = dateFromMatch[1];
    }
    const dateToMatch = query.match(/before:([^\s]+)/i);
    if (dateToMatch) {
      criteria.dateTo = dateToMatch[1];
    }

    // If no special prefix, treat as message search
    if (!criteria.author && !criteria.filePath && !criteria.shaPrefix && !criteria.dateFrom && !criteria.dateTo) {
      criteria.message = query;
    }

    return criteria;
  }

  protected renderHighlightedText = (text: string, highlights: Array<{ start: number; end: number }>): React.ReactNode => {
    if (!highlights.length) return text;

    const sorted = [...highlights].sort((a, b) => a.start - b.start);
    const parts: React.ReactNode[] = [];
    let lastEnd = 0;

    for (const h of sorted) {
      if (h.start > lastEnd) {
        parts.push(text.substring(lastEnd, h.start));
      }
      parts.push(
        <mark key={`${h.start}-${h.end}`} className="kairo-search-highlight">
          {text.substring(h.start, h.end)}
        </mark>
      );
      lastEnd = h.end;
    }
    if (lastEnd < text.length) {
      parts.push(text.substring(lastEnd));
    }

    return <>{parts}</>;
  };

  protected render(): React.ReactNode {
    const displayCommits = this.searchQuery.trim() ? this.searchResults.map(r => r.commit) : this.commits;
    const searchHighlights = this.searchQuery.trim()
      ? new Map(this.searchResults.map(r => [r.commit.hash, r.highlights]))
      : new Map<string, typeof this.searchResults[0]['highlights']>();

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'var(--theia-ui-font-family)', fontSize: 'var(--theia-ui-font-size1)' }}>
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--theia-sideBarSectionHeader-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 600 }}>Commits</span>
          <button
            className="theia-button secondary"
            onClick={() => this.loadHistory()}
            style={{ fontSize: 'var(--theia-ui-font-size0)' }}
          >
            Refresh
          </button>
        </div>

        {/* Search Bar */}
        <div style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--theia-sideBarSectionHeader-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="text"
              className="kairo-history-search-input"
              placeholder="搜索提交 (author:xxx, path:xxx, after:2024-01-01, SHA…)"
              value={this.searchQuery}
              onChange={e => this.handleSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '4px 8px',
                backgroundColor: 'var(--theia-input-background)',
                color: 'var(--theia-input-foreground)',
                border: '1px solid var(--theia-input-border)',
                borderRadius: 2,
                fontSize: 'var(--theia-ui-font-size0)',
              }}
            />
            {this.isSearching && (
              <span style={{ fontSize: 'var(--theia-ui-font-size0)', color: 'var(--theia-descriptionForeground)', whiteSpace: 'nowrap' }}>
                搜索中…
              </span>
            )}
          </div>
          {this.searchQuery.trim() && !this.isSearching && (
            <div style={{
              fontSize: 'var(--theia-ui-font-size0)',
              color: 'var(--theia-descriptionForeground)',
              marginTop: 4,
            }}>
              {this.searchSummary.totalCount} 个结果
              {this.searchSummary.status === 'timed_out' && ' (搜索超时)'}
              {this.searchSummary.status === 'error' && ` (${this.searchSummary.error})`}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {this.renderContent(displayCommits, searchHighlights)}
        </div>
      </div>
    );
  }

  protected renderContent(
    displayCommits: GitCommit[],
    highlights: Map<string, Array<{ start: number; end: number; field: string }>>,
  ): React.ReactNode {
    if (this.loading || this.isSearching) {
      return <div style={{ padding: 16, color: 'var(--theia-descriptionForeground)' }}>加载中...</div>;
    }
    if (displayCommits.length === 0) {
      if (this.searchQuery.trim()) {
        return <div style={{ padding: 16, color: 'var(--theia-descriptionForeground)' }}>未找到匹配的提交。</div>;
      }
      return <div style={{ padding: 16, color: 'var(--theia-descriptionForeground)' }}>没有提交记录。</div>;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {displayCommits.map(commit => this.renderCommitItem(commit, highlights.get(commit.hash) || []))}
        </div>
        {this.selectedCommit && this.renderCommitDetail()}
      </div>
    );
  }

  protected renderCommitItem(
    commit: GitCommit,
    commitHighlights: Array<{ start: number; end: number; field: string }>,
  ): React.ReactNode {
    const isSelected = this.selectedCommit?.hash === commit.hash;
    const shortHash = commit.hash.substring(0, 7);
    const dateStr = commit.date.toLocaleDateString();

    const msgHighlights = commitHighlights.filter(h => h.field === 'message');
    const authorHighlights = commitHighlights.filter(h => h.field === 'author');
    const hashHighlights = commitHighlights.filter(h => h.field === 'hash');

    const displayMessage = commit.message.length > 60 ? commit.message.substring(0, 57) + '...' : commit.message;

    return (
      <div
        key={commit.hash}
        onClick={() => this.selectCommit(commit)}
        style={{
          padding: '6px 12px',
          cursor: 'pointer',
          borderBottom: '1px solid var(--theia-sideBarSectionHeader-border)',
          backgroundColor: isSelected ? 'var(--theia-list-activeSelectionBackground)' : 'transparent',
          color: isSelected ? 'var(--theia-list-activeSelectionForeground)' : 'var(--theia-foreground)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--theia-ui-font-size1)' }}>
            {msgHighlights.length > 0
              ? this.renderHighlightedText(displayMessage, msgHighlights)
              : displayMessage}
          </span>
          <span style={{ fontSize: 'var(--theia-ui-font-size0)', color: 'var(--theia-descriptionForeground)', flexShrink: 0, marginLeft: 8 }}>
            {hashHighlights.length > 0
              ? this.renderHighlightedText(shortHash, hashHighlights)
              : shortHash}
          </span>
        </div>
        <div style={{ fontSize: 'var(--theia-ui-font-size0)', color: 'var(--theia-descriptionForeground)', marginTop: 2 }}>
          {authorHighlights.length > 0
            ? this.renderHighlightedText(commit.author, authorHighlights)
            : commit.author}
          {' · '}
          {dateStr}
        </div>
        <div style={{ marginTop: 4, display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <button
            className="theia-button secondary"
            onClick={(e) => this.handleCherryPick(commit, e)}
            style={{ fontSize: 'var(--theia-ui-font-size0)', padding: '2px 8px' }}
            aria-label={`Cherry-pick ${commit.hash.substring(0, 7)}`}
            title="Cherry-pick this commit"
          >
            Cherry-Pick
          </button>
        </div>
      </div>
    );
  }

  protected renderCommitDetail(): React.ReactNode {
    if (!this.selectedCommit) return null;

    const commit = this.selectedCommit;
    const fullMessage = commit.message;
    const subject = fullMessage.split('\n')[0];
    const body = fullMessage.split('\n').slice(1).join('\n').trim();

    return (
      <div style={{
        borderTop: '2px solid var(--theia-sideBarSectionHeader-border)',
        padding: 12,
        maxHeight: '40%',
        overflow: 'auto',
      }}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 'var(--theia-ui-font-size1)' }}>
          {subject}
        </div>
        {body && (
          <div style={{
            fontSize: 'var(--theia-ui-font-size0)',
            color: 'var(--theia-descriptionForeground)',
            marginBottom: 8,
            whiteSpace: 'pre-wrap',
          }}>
            {body}
          </div>
        )}
        <div style={{ fontSize: 'var(--theia-ui-font-size0)', color: 'var(--theia-descriptionForeground)' }}>
          <div><strong>Commit:</strong> {commit.hash}</div>
          <div><strong>Author:</strong> {commit.author} &lt;{commit.email}&gt;</div>
          <div><strong>Date:</strong> {commit.date.toLocaleString()}</div>
        </div>
      </div>
    );
  }
}