import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { GitStore } from './git-store';
import { GitService } from './git-service';

interface DiffLine {
    type: 'header' | 'add' | 'remove' | 'context' | 'hunk';
    oldLine?: number;
    newLine?: number;
    content: string;
}

interface GitDiffProps {
    store: GitStore;
    gitService: GitService;
}

const GitDiffComponent: React.FC<GitDiffProps> = ({ store, gitService }) => {
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

    const loadDiff = async (f: string, s: boolean) => {
        setLoading(true);
        try {
            const result = await gitService.getDiff(f, s);
            const lines = parseDiff(result.diff);
            setDiffLines(lines);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    const parseDiff = (diff: string): DiffLine[] => {
        const lines: DiffLine[] = [];
        let oldLine = 0;
        let newLine = 0;

        for (const line of diff.split('\n')) {
            if (line.startsWith('diff ') || line.startsWith('index ') ||
                line.startsWith('--- ') || line.startsWith('+++ ')) {
                lines.push({ type: 'header', content: line });
            } else if (line.startsWith('@@')) {
                const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
                if (match) {
                    oldLine = parseInt(match[1], 10);
                    newLine = parseInt(match[3], 10);
                }
                lines.push({ type: 'hunk', content: line });
            } else if (line.startsWith('+')) {
                lines.push({ type: 'add', content: line, newLine: newLine++ });
            } else if (line.startsWith('-')) {
                lines.push({ type: 'remove', content: line, oldLine: oldLine++ });
            } else {
                lines.push({ type: 'context', content: line, oldLine: oldLine++, newLine: newLine++ });
            }
        }
        return lines;
    };

    const lineClass = (type: DiffLine['type']): string => {
        switch (type) {
            case 'header': return 'kairo-diff-header';
            case 'hunk': return 'kairo-diff-hunk';
            case 'add': return 'kairo-diff-add';
            case 'remove': return 'kairo-diff-remove';
            case 'context': return 'kairo-diff-context';
        }
    };

    if (!file) {
        return (
            <div className="kairo-widget" data-testid="git-diff-view">
                <div className="kairo-widget-header">
                    <span className="kairo-widget-title">Diff</span>
                </div>
                <p className="kairo-empty">Select a file from the Changes view to see its diff.</p>
            </div>
        );
    }

    return (
        <div className="kairo-widget" data-testid="git-diff-view">
            <div className="kairo-widget-header" data-testid="git-diff-header">
                <span className="kairo-widget-title">Diff</span>
                <span className="kairo-git-diff-file" data-testid="git-diff-file">
                    {file}
                    {staged && ' (staged)'}
                </span>
            </div>

            {loading && <p className="kairo-empty">Loading diff…</p>}
            {error && <div className="theia-error" role="alert">{error}</div>}

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

    constructor() {
        super();
        this.id = GitDiffWidget.ID;
        this.title.label = 'Git Diff';
        this.title.caption = 'Git Diff View';
        this.addClass('kairo-widget');
    }

    protected render(): React.ReactNode {
        return React.createElement(GitDiffComponent, { store: this.store, gitService: this.gitService });
    }
}