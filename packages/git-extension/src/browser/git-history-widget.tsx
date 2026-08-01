import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KairoI18nService } from '@kairo/i18n';
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
    @inject(KairoI18nService) protected i18n!: KairoI18nService;

    constructor() {
        super();
        this.title.label = '';
        this.title.caption = '';
    }

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
        this.title.closable = true;
        this.updateTitle();
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
        this.update();
    }

    protected updateTitle(): void {
        this.title.label = this.i18n.t('widget.git.history.title' as any);
        this.title.caption = this.i18n.t('widget.git.history.caption' as any);
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

    protected t(key: string, params?: Record<string, string | number>): string {
        return this.i18n.t(key as any, params);
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
            <div className="kairo-widget kairo-history-widget" data-testid="git-history-view">
                <div className="kairo-widget-header kairo-history-header" data-testid="git-history-header">
                    <span className="kairo-widget-title">{this.t('widget.git.history.title')}</span>
                    <button
                        className="theia-button secondary kairo-history-refresh"
                        onClick={() => this.loadHistory()}
                        aria-label={this.t('widget.git.history.refreshButtonAria')}
                    >
                        {this.t('widget.git.history.refreshButton')}
                    </button>
                </div>

                {/* Search Bar */}
                <div className="kairo-history-searchbar" data-testid="git-history-searchbar">
                    <div className="kairo-history-search-row">
                        <input
                            type="text"
                            className="kairo-history-search-input"
                            placeholder={this.t('widget.git.history.searchPlaceholder')}
                            value={this.searchQuery}
                            onChange={e => this.handleSearch(e.target.value)}
                        />
                        {this.isSearching && (
                            <span className="kairo-history-search-status">
                                {this.t('widget.git.history.searching')}
                            </span>
                        )}
                    </div>
                    {this.searchQuery.trim() && !this.isSearching && (
                        <div className="kairo-history-search-summary">
                            {this.t('widget.git.history.resultsCount', { count: this.searchSummary.totalCount })}
                            {this.searchSummary.status === 'timed_out' && this.t('widget.git.history.searchTimedOut')}
                            {this.searchSummary.status === 'error' && ` (${this.searchSummary.error})`}
                        </div>
                    )}
                </div>

                <div className="kairo-widget-body kairo-history-body">
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
            return (
                <div className="kairo-loading" data-testid="git-history-loading">
                    <span className="kairo-loading-icon codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                    <span>{this.t('common.loading')}</span>
                </div>
            );
        }
        if (displayCommits.length === 0) {
            if (this.searchQuery.trim()) {
                return (
                    <div className="kairo-empty-state" data-testid="git-history-no-results">
                        <span className="kairo-empty-state-glyph codicon codicon-search" aria-hidden="true" />
                        <h3 className="kairo-empty-state-title">{this.t('widget.git.history.noSearchResults')}</h3>
                    </div>
                );
            }
            return (
                <div className="kairo-empty-state" data-testid="git-history-empty">
                    <span className="kairo-empty-state-glyph codicon codicon-git-commit" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{this.t('widget.git.history.noCommits')}</h3>
                </div>
            );
        }

        return (
            <div className="kairo-history-content">
                <div className="kairo-history-list">
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
                className={`kairo-history-item ${isSelected ? 'kairo-history-item-selected' : ''}`}
                data-testid={`git-history-item-${commit.hash}`}
            >
                <div className="kairo-history-item-main">
                    <span className="kairo-history-item-message">
                        {msgHighlights.length > 0
                            ? this.renderHighlightedText(displayMessage, msgHighlights)
                            : displayMessage}
                    </span>
                    <span className="kairo-history-item-hash">
                        {hashHighlights.length > 0
                            ? this.renderHighlightedText(shortHash, hashHighlights)
                            : shortHash}
                    </span>
                </div>
                <div className="kairo-history-item-meta">
                    {authorHighlights.length > 0
                        ? this.renderHighlightedText(commit.author, authorHighlights)
                        : commit.author}
                    {' · '}
                    {dateStr}
                </div>
                <div className="kairo-history-item-actions" onClick={e => e.stopPropagation()}>
                    <button
                        className="theia-button secondary kairo-history-action-btn"
                        onClick={(e) => this.handleCherryPick(commit, e)}
                        aria-label={this.t('widget.git.history.cherryPickAria', { hash: commit.hash.substring(0, 7) })}
                        title={this.t('widget.git.history.cherryPickTitle')}
                    >
                        {this.t('widget.git.history.cherryPickButton')}
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
            <div className="kairo-history-detail" data-testid="git-history-detail">
                <div className="kairo-history-detail-subject">{subject}</div>
                {body && (
                    <div className="kairo-history-detail-body">{body}</div>
                )}
                <div className="kairo-history-detail-meta">
                    <div><strong>{this.t('widget.git.history.detail.commit')}</strong> {commit.hash}</div>
                    <div><strong>{this.t('widget.git.history.detail.author')}</strong> {commit.author} &lt;{commit.email}&gt;</div>
                    <div><strong>{this.t('widget.git.history.detail.date')}</strong> {commit.date.toLocaleString()}</div>
                </div>
            </div>
        );
    }
}
