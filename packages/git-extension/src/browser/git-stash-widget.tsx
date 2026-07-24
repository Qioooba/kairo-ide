import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { GitStashService, GitStashEntry, GitStashShowResult } from './git-stash-service';

interface StashWidgetProps {
  stashService: GitStashService;
}

const StashComponent: React.FC<StashWidgetProps> = ({ stashService }) => {
  const [entries, setEntries] = React.useState<GitStashEntry[]>([]);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [message, setMessage] = React.useState<string>('');
  const [includeUntracked, setIncludeUntracked] = React.useState<boolean>(false);
  const [stagedOnly, setStagedOnly] = React.useState<boolean>(false);
  const [selectedEntry, setSelectedEntry] = React.useState<GitStashEntry | undefined>();
  const [showResult, setShowResult] = React.useState<GitStashShowResult | undefined>();
  const [error, setError] = React.useState<string>('');

  const loadEntries = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await stashService.list();
      setEntries(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [stashService]);

  React.useEffect(() => {
    loadEntries();
    const sub = stashService.onDidChange(() => loadEntries());
    return () => sub.dispose();
  }, [stashService, loadEntries]);

  const handlePush = async () => {
    setError('');
    try {
      await stashService.push(message || undefined, includeUntracked, stagedOnly);
      setMessage('');
      setIncludeUntracked(false);
      setStagedOnly(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePop = async (ref?: string) => {
    setError('');
    try {
      await stashService.pop(ref);
      setSelectedEntry(undefined);
      setShowResult(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleApply = async (ref?: string) => {
    setError('');
    try {
      await stashService.apply(ref);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDrop = async (ref?: string) => {
    setError('');
    try {
      await stashService.drop(ref);
      setSelectedEntry(undefined);
      setShowResult(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleShow = async (entry: GitStashEntry) => {
    setSelectedEntry(entry);
    setShowResult(undefined);
    setError('');
    try {
      const result = await stashService.show(entry.ref);
      setShowResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClear = async () => {
    setError('');
    try {
      await stashService.clear();
      setSelectedEntry(undefined);
      setShowResult(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const formatDate = (d: Date): string => {
    return d.toLocaleString();
  };

  return (
    <div className="kairo-widget" data-testid="git-stash-view">
      <div className="kairo-widget-header" data-testid="git-stash-header">
        <span className="kairo-widget-title">Git Stash</span>
      </div>

      {/* Stash push area */}
      <div className="kairo-widget-section" data-testid="git-stash-push-section">
        <div className="kairo-section-header">
          <span className="kairo-section-title">Save Stash</span>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <input
            type="text"
            className="kairo-history-search-input"
            placeholder="Stash message (optional)"
            value={message}
            onChange={e => setMessage(e.target.value)}
            style={{
              width: '100%',
              padding: '4px 8px',
              backgroundColor: 'var(--theia-input-background)',
              color: 'var(--theia-input-foreground)',
              border: '1px solid var(--theia-input-border)',
              borderRadius: 2,
              fontSize: 'var(--theia-ui-font-size0)',
              marginBottom: 6,
            }}
          />
          <div style={{ display: 'flex', gap: 12, marginBottom: 6, fontSize: 'var(--theia-ui-font-size0)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={includeUntracked}
                onChange={e => setIncludeUntracked(e.target.checked)}
              />
              Include untracked
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={stagedOnly}
                onChange={e => setStagedOnly(e.target.checked)}
              />
              Staged only
            </label>
          </div>
          <button
            className="theia-button"
            onClick={handlePush}
            disabled={loading}
            aria-label="Push stash"
          >
            Save Stash
          </button>
        </div>
      </div>

      {error && (
        <div className="theia-error" role="alert" data-testid="git-stash-error">
          {error}
        </div>
      )}

      {/* Stash list */}
      <div className="kairo-widget-section" data-testid="git-stash-list-section">
        <div className="kairo-section-header">
          <span className="kairo-section-title">
            Stashes{entries.length > 0 ? ` (${entries.length})` : ''}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="theia-button secondary"
              onClick={loadEntries}
              disabled={loading}
              aria-label="Refresh stash list"
              style={{ fontSize: 'var(--theia-ui-font-size0)' }}
            >
              Refresh
            </button>
            {entries.length > 0 && (
              <button
                className="theia-button secondary"
                onClick={handleClear}
                aria-label="Clear all stashes"
                style={{ fontSize: 'var(--theia-ui-font-size0)' }}
              >
                Clear All
              </button>
            )}
          </div>
        </div>

        {loading && entries.length === 0 && (
          <p className="kairo-empty">Loading...</p>
        )}
        {!loading && entries.length === 0 && (
          <p className="kairo-empty">No stashes</p>
        )}
        {entries.map(entry => (
          <div
            key={entry.ref}
            data-testid={`git-stash-item-${entry.index}`}
            style={{
              padding: '6px 12px',
              cursor: 'pointer',
              borderBottom: '1px solid var(--theia-sideBarSectionHeader-border)',
              backgroundColor: selectedEntry?.ref === entry.ref
                ? 'var(--theia-list-activeSelectionBackground)'
                : 'transparent',
              color: selectedEntry?.ref === entry.ref
                ? 'var(--theia-list-activeSelectionForeground)'
                : 'var(--theia-foreground)',
            }}
            onClick={() => handleShow(entry)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--theia-ui-font-size1)' }}>
                {entry.ref}
              </span>
              <span style={{ fontSize: 'var(--theia-ui-font-size0)', color: 'var(--theia-descriptionForeground)', flexShrink: 0, marginLeft: 8 }}>
                {entry.hash.substring(0, 7)}
              </span>
            </div>
            <div style={{ fontSize: 'var(--theia-ui-font-size0)', color: 'var(--theia-descriptionForeground)', marginTop: 2 }}>
              {entry.message}
            </div>
            <div style={{ fontSize: 'var(--theia-ui-font-size0)', color: 'var(--theia-descriptionForeground)' }}>
              {entry.branch && `Branch: ${entry.branch} · `}{formatDate(entry.date)}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }} onClick={e => e.stopPropagation()}>
              <button
                className="theia-button"
                onClick={() => handlePop(entry.ref)}
                style={{ fontSize: 'var(--theia-ui-font-size0)', padding: '2px 8px' }}
                aria-label={`Pop stash ${entry.ref}`}
              >
                Pop
              </button>
              <button
                className="theia-button secondary"
                onClick={() => handleApply(entry.ref)}
                style={{ fontSize: 'var(--theia-ui-font-size0)', padding: '2px 8px' }}
                aria-label={`Apply stash ${entry.ref}`}
              >
                Apply
              </button>
              <button
                className="theia-button secondary"
                onClick={() => handleDrop(entry.ref)}
                style={{ fontSize: 'var(--theia-ui-font-size0)', padding: '2px 8px' }}
                aria-label={`Drop stash ${entry.ref}`}
              >
                Drop
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Show result */}
      {showResult && (
        <div className="kairo-widget-section" data-testid="git-stash-show-section">
          <div className="kairo-section-header">
            <span className="kairo-section-title">Stash Diff: {selectedEntry?.ref}</span>
          </div>
          <div style={{ padding: '8px 12px', maxHeight: 300, overflow: 'auto' }}>
            <pre style={{
              fontFamily: 'var(--theia-editor-font-family)',
              fontSize: 'var(--theia-code-font-size)',
              margin: 0,
              whiteSpace: 'pre-wrap',
            }}>
              {showResult.stat || showResult.diff || 'No diff content'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

@injectable()
export class GitStashWidget extends ReactWidget {
  static readonly ID = 'kairo-git-stash';

  @inject(GitStashService) protected readonly stashService!: GitStashService;

  constructor() {
    super();
    this.id = GitStashWidget.ID;
    this.title.label = 'Git Stash';
    this.title.caption = 'Git Stash View';
    this.title.closable = true;
    this.addClass('kairo-widget');
  }

  protected render(): React.ReactNode {
    return React.createElement(StashComponent, { stashService: this.stashService });
  }
}
