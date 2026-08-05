import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KairoI18nService } from '@kairo/i18n';
import { GitStore } from './git-store';
import { GitService } from './git-service';
import { parseDiff, type DiffLine } from './git-diff-parse';

interface GitDiffProps {
    store: GitStore;
    gitService: GitService;
    i18n: KairoI18nService;
}

const GitDiffComponent: React.FC<GitDiffProps> = ({ store, gitService, i18n }) => {
    const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    const [file, setFile] = React.useState<string>('');
    const [staged, setStaged] = React.useState<boolean>(false);
    const [diffLines, setDiffLines] = React.useState<DiffLine[]>([]);
    const [loading, setLoading] = React.useState<boolean>(false);
    const [error, setError] = React.useState<string>('');

    React.useEffect(() => {
        const sub = store.onDiffRequest(req => {
            setFile(req.file);
            setStaged(req.staged);
            setDiffLines([]);
            setError('');
            loadDiff(req.file, req.staged);
        });
        return () => sub.dispose();
    }, [store, gitService]);

    React.useEffect(() => {
        const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
        return () => disposable.dispose();
    }, [i18n]);

    const loadDiff = async (f: string, s: boolean) => {
        setLoading(true);
        try {
            const result = await gitService.getDiff(f, s);
            setDiffLines(parseDiff(result.diff));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    const lineClass = (type: DiffLine['type']): string => {
        switch (type) {
            case 'header': return 'kairo-diff-header';
            case 'hunk': return 'kairo-diff-hunk';
            case 'add': return 'kairo-diff-add';
            case 'remove': return 'kairo-diff-remove';
            case 'context': return 'kairo-diff-context';
            case 'meta': return 'kairo-diff-header';
        }
    };

    if (!file) {
        return (
            <div className="kairo-widget" data-testid="git-diff-view">
                <div className="kairo-widget-header" data-testid="git-diff-header">
                    <span className="kairo-widget-title">{t('widget.git.diff.title')}</span>
                </div>
                <div className="kairo-empty-state" data-testid="git-diff-empty">
                    <span className="kairo-empty-state-glyph codicon codicon-diff" aria-hidden="true" />
                    <h3 className="kairo-empty-state-title">{t('widget.git.diff.emptyStateTitle')}</h3>
                    <p className="kairo-empty-state-reason">{t('widget.git.diff.emptyStateReason')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="kairo-widget" data-testid="git-diff-view">
            <div className="kairo-widget-header" data-testid="git-diff-header">
                <span className="kairo-widget-title">{t('widget.git.diff.title')}</span>
                <span className="kairo-git-diff-file" data-testid="git-diff-file">
                    {file}
                    {staged && t('widget.git.diff.stagedSuffix')}
                </span>
            </div>

            {loading && (
                <div className="kairo-loading" data-testid="git-diff-loading">
                    <span className="kairo-loading-icon codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
                    <span>{t('widget.git.diff.loading')}</span>
                </div>
            )}
            {error && (
                <div className="kairo-error-banner" role="alert" data-testid="git-diff-error">
                    <span className="codicon codicon-error" aria-hidden="true" />
                    <span>{error}</span>
                </div>
            )}

            {!loading && diffLines.length > 0 && (
                <div className="kairo-diff-container" data-testid="git-diff-content">
                    <pre className="kairo-diff-pre">
                        {diffLines.map((l, i) => (
                            <div key={i} className={`kairo-diff-line ${lineClass(l.type)}`}>
                                <span className="kairo-diff-line-num kairo-diff-old-num">
                                    {l.oldLine !== undefined ? l.oldLine : ''}
                                </span>
                                <span className="kairo-diff-line-num kairo-diff-new-num">
                                    {l.newLine !== undefined ? l.newLine : ''}
                                </span>
                                <span className="kairo-diff-line-content">{l.content}</span>
                            </div>
                        ))}
                    </pre>
                </div>
            )}
        </div>
    );
};

@injectable()
export class GitDiffWidget extends ReactWidget {
    static readonly ID = 'kairo-git-diff-view';

    @inject(GitStore) protected readonly store!: GitStore;
    @inject(GitService) protected readonly gitService!: GitService;
    @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

    constructor() {
        super();
        this.id = GitDiffWidget.ID;
        this.title.label = '';
        this.title.caption = '';
        this.addClass('kairo-widget');
    }

    @postConstruct()
    protected init(): void {
        this.updateTitle();
        this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
    }

    protected updateTitle(): void {
        this.title.label = this.i18n.t('widget.git.diff.title' as any);
        this.title.caption = this.i18n.t('widget.git.diff.caption' as any);
    }

    protected render(): React.ReactNode {
        return React.createElement(GitDiffComponent, {
            store: this.store,
            gitService: this.gitService,
            i18n: this.i18n,
        });
    }
}
