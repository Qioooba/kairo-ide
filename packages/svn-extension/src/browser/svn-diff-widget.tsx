import * as React from 'react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { injectable, inject } from '@theia/core/shared/inversify';
import { SvnService } from './svn-service';

interface SvnDiffProps {
  svnService: SvnService;
  filePath?: string;
  baseRevision?: number;
  targetRevision?: number;
}

const SvnDiffComponent: React.FC<SvnDiffProps> = ({ svnService, filePath: initialPath, baseRevision, targetRevision }) => {
  const [diffContent, setDiffContent] = React.useState<string>('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>('');
  const [filePath, setFilePath] = React.useState(initialPath || '');
  const [rev1, setRev1] = React.useState(baseRevision?.toString() || 'BASE');
  const [rev2, setRev2] = React.useState(targetRevision?.toString() || 'WORKING');

  React.useEffect(() => {
    if (initialPath) {
      setFilePath(initialPath);
      loadDiff(initialPath, rev1, rev2);
    }
  }, [initialPath]);

  const loadDiff = React.useCallback(async (path: string, r1: string, r2: string) => {
    setLoading(true);
    setError('');
    try {
      const diffOptions: any = {};
      if (r2 !== 'WORKING') {
        const newRev = Number(r2);
        if (!isNaN(newRev)) {
          diffOptions.revision = newRev;
        }
      }
      if (r1 !== 'WORKING') {
        const oldRev = Number(r1);
        if (!isNaN(oldRev)) {
          diffOptions.oldRevision = oldRev;
        }
      }
      if (r1.match(/^(BASE|HEAD|PREV|COMMITTED)$/i)) {
        diffOptions.revision = r1.toUpperCase() as any;
      }
      const diff = await svnService.getDiff(path, diffOptions);
      setDiffContent(diff);
    } catch (e) {
      setError((e as Error).message || 'Failed to load diff');
    } finally {
      setLoading(false);
    }
  }, [svnService]);

  const handleLoadDiff = () => {
    if (filePath) loadDiff(filePath, rev1, rev2);
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column' as const,
      height: '100%',
      backgroundColor: 'var(--theia-editor-background)',
      color: 'var(--theia-editor-foreground)',
    },
    toolbar: {
      display: 'flex',
      gap: '8px',
      padding: '8px',
      borderBottom: '1px solid var(--theia-dropdown-border)',
      alignItems: 'center',
      flexWrap: 'wrap' as const,
    },
    input: {
      padding: '4px 8px',
      backgroundColor: 'var(--theia-input-background)',
      color: 'var(--theia-input-foreground)',
      border: '1px solid var(--theia-input-border)',
      borderRadius: '2px',
      fontSize: '12px',
    },
    button: {
      padding: '4px 12px',
      backgroundColor: 'var(--theia-button-background)',
      color: 'var(--theia-button-foreground)',
      border: 'none',
      borderRadius: '2px',
      cursor: 'pointer',
      fontSize: '12px',
    },
    diffContent: {
      flex: 1,
      overflow: 'auto' as const,
      fontFamily: 'var(--theia-editor-font-family, monospace)',
      fontSize: 'var(--theia-editor-font-size, 13px)',
      padding: '8px',
      whiteSpace: 'pre-wrap' as const,
      lineHeight: '1.5',
    },
    addedLine: {
      backgroundColor: 'var(--theia-diffEditor-insertedTextBackground)',
      color: 'var(--theia-diffEditor-insertedTextColor)',
    },
    removedLine: {
      backgroundColor: 'var(--theia-diffEditor-removedTextBackground)',
      color: 'var(--theia-diffEditor-removedTextColor)',
    },
    headerLine: {
      color: 'var(--theia-editorLineNumber-foreground)',
    },
    loading: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: 'var(--theia-descriptionForeground)',
    },
    error: {
      color: 'var(--theia-errorForeground)',
      padding: '8px',
    },
  };

  const renderDiffLines = () => {
    if (!diffContent) return null;
    return diffContent.split('\n').map((line, i) => {
      let lineStyle = {};
      if (line.startsWith('+') && !line.startsWith('+++')) {
        lineStyle = styles.addedLine;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        lineStyle = styles.removedLine;
      } else if (line.startsWith('@@') || line.startsWith('Index:') || line.startsWith('===')) {
        lineStyle = styles.headerLine;
      }
      return (
        <div key={i} style={lineStyle}>
          {line}
        </div>
      );
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <input
          style={{ ...styles.input, flex: 1, minWidth: '200px' }}
          value={filePath}
          onChange={e => setFilePath(e.target.value)}
          placeholder="File path relative to WC root"
          onKeyDown={e => { if (e.key === 'Enter') handleLoadDiff(); }}
        />
        <span style={{ fontSize: '12px' }}>@</span>
        <input
          style={{ ...styles.input, width: '80px' }}
          value={rev1}
          onChange={e => setRev1(e.target.value)}
          placeholder="BASE"
        />
        <span style={{ fontSize: '12px' }}>:</span>
        <input
          style={{ ...styles.input, width: '80px' }}
          value={rev2}
          onChange={e => setRev2(e.target.value)}
          placeholder="WORKING"
        />
        <button style={styles.button} onClick={handleLoadDiff}>Show Diff</button>
      </div>
      {loading ? (
        <div style={styles.loading}>Loading diff...</div>
      ) : error ? (
        <div style={styles.error}>{error}</div>
      ) : (
        <div style={styles.diffContent}>
          {renderDiffLines()}
        </div>
      )}
    </div>
  );
};

@injectable()
export class SvnDiffWidget extends ReactWidget {
  static readonly ID = 'kairo-svn-diff-widget';
  static readonly LABEL = 'SVN Diff';

  @inject(SvnService) protected readonly svnService!: SvnService;

  protected filePath: string = '';
  protected baseRevision: number | undefined;
  protected targetRevision: number | undefined;

  constructor() {
    super();
    this.id = SvnDiffWidget.ID;
    this.title.label = SvnDiffWidget.LABEL;
    this.title.caption = SvnDiffWidget.LABEL;
    this.title.iconClass = 'codicon codicon-diff';
    this.title.closable = true;
    this.addClass('kairo-svn-diff-widget');
  }

  setDiffTarget(filePath: string, baseRevision?: number, targetRevision?: number): void {
    this.filePath = filePath;
    this.baseRevision = baseRevision;
    this.targetRevision = targetRevision;
    this.title.label = `SVN Diff: ${filePath.split('/').pop() || filePath}`;
    this.update();
  }

  protected render(): React.ReactNode {
    return React.createElement(SvnDiffComponent, {
      svnService: this.svnService,
      filePath: this.filePath,
      baseRevision: this.baseRevision,
      targetRevision: this.targetRevision,
    });
  }
}