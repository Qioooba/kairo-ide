// SPDX-License-Identifier: Apache-2.0
//
// Kairo SVN Diff Widget — IDEA-style side-by-side diff using Monaco's
// built-in DiffEditor. Supports:
//   - Local vs BASE
//   - Local vs HEAD
//   - Local vs Revision (with revision picker via QuickPick)
//   - Revision A vs Revision B (with two revision pickers)
//
// Provides character-level inline highlights, minimap, prev/next diff
// navigation, and synchronized scrolling — all from Monaco out of the box.

import * as React from 'react';
import * as monaco from '@theia/monaco-editor-core';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { QuickInputService } from '@theia/core/lib/browser/quick-input/quick-input-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { SvnService } from './svn-service';
import { SvnLogEntry } from './svn-types';

export type SvnDiffMode = 'local-base' | 'local-head' | 'local-rev' | 'rev-rev';

interface SvnDiffComponentProps {
  svnService: SvnService;
  fileService: FileService;
  quickInputService: QuickInputService;
  messageService: MessageService;
  workspaceService: WorkspaceService;
  initialFilePath?: string;
  initialBaseRevision?: string | number;
  initialTargetRevision?: string | number;
  onPickRevision: (target: 'left' | 'right') => Promise<string | number | undefined>;
  onLoadDiff: (
    filePath: string,
    mode: SvnDiffMode,
    left: string | number,
    right: string | number,
  ) => Promise<{ leftContent: string; rightContent: string; leftLabel: string; rightLabel: string }>;
}

const SvnDiffComponent: React.FC<SvnDiffComponentProps> = (props) => {
  const {
    svnService,
    fileService,
    quickInputService,
    messageService,
    workspaceService,
    initialFilePath,
    initialBaseRevision,
    initialTargetRevision,
    onPickRevision,
    onLoadDiff,
  } = props;

  const [filePath, setFilePath] = React.useState<string>(initialFilePath || '');
  const [mode, setMode] = React.useState<SvnDiffMode>(
    initialBaseRevision !== undefined || initialTargetRevision !== undefined ? 'rev-rev' : 'local-base',
  );
  const [leftRev, setLeftRev] = React.useState<string>(
    initialBaseRevision !== undefined ? String(initialBaseRevision) : 'BASE',
  );
  const [rightRev, setRightRev] = React.useState<string>(
    initialTargetRevision !== undefined ? String(initialTargetRevision) : 'HEAD',
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>('');
  const [leftLabel, setLeftLabel] = React.useState<string>('');
  const [rightLabel, setRightLabel] = React.useState<string>('');
  const [available, setAvailable] = React.useState<boolean>(false);

  // The Monaco diff editor instance + container
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const diffEditorRef = React.useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = React.useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = React.useRef<monaco.editor.ITextModel | null>(null);

  React.useEffect(() => {
    setAvailable(svnService.isSvnAvailable());
    const sub = svnService.onSvnAvailabilityChange(setAvailable);
    return () => sub.dispose();
  }, [svnService]);

  // Mount the Monaco DiffEditor once
  React.useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      automaticLayout: true,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      originalEditable: false,
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      renderOverviewRuler: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: true },
      fontSize: 13,
      readOnly: true,
    });
    diffEditorRef.current = editor;
    return () => {
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      originalModelRef.current = null;
      modifiedModelRef.current = null;
      diffEditorRef.current?.dispose();
      diffEditorRef.current = null;
    };
  }, []);

  const applyModels = React.useCallback((leftContent: string, rightContent: string, path: string) => {
    if (!diffEditorRef.current) return;
    const lang = detectLanguageFromPath(path);

    originalModelRef.current?.dispose();
    modifiedModelRef.current?.dispose();

    const leftUri = monaco.Uri.parse(`inmemory://svn-diff/left/${encodeURIComponent(path)}`);
    const rightUri = monaco.Uri.parse(`inmemory://svn-diff/right/${encodeURIComponent(path)}`);

    const original = monaco.editor.createModel(leftContent, lang, leftUri);
    const modified = monaco.editor.createModel(rightContent, lang, rightUri);
    originalModelRef.current = original;
    modifiedModelRef.current = modified;
    diffEditorRef.current.setModel({ original, modified });
  }, []);

  const loadAndApply = React.useCallback(async (
    fp: string,
    md: SvnDiffMode,
    l: string | number,
    r: string | number,
  ) => {
    if (!fp) {
      setError('Please enter a file path');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await onLoadDiff(fp, md, l, r);
      if (!result.leftContent && !result.rightContent) {
        setError('No diff content available (file may be binary or unversioned)');
      } else {
        applyModels(result.leftContent, result.rightContent, fp);
        setLeftLabel(result.leftLabel);
        setRightLabel(result.rightLabel);
      }
    } catch (e) {
      setError((e as Error).message || 'Failed to load diff');
    } finally {
      setLoading(false);
    }
  }, [onLoadDiff, applyModels]);

  // Auto-load when initial values provided
  React.useEffect(() => {
    if (initialFilePath) {
      void loadAndApply(initialFilePath, mode, leftRev, rightRev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleShowDiff = () => {
    if (!filePath) {
      messageService.warn('Please enter a file path first');
      return;
    }
    void loadAndApply(filePath, mode, leftRev, rightRev);
  };

  const handleSwap = () => {
    const newMode: SvnDiffMode = mode === 'rev-rev' ? 'rev-rev' : mode;
    const oldLeft = leftRev;
    const oldRight = rightRev;
    const oldLeftLabel = leftLabel;
    const oldRightLabel = rightLabel;
    setLeftRev(oldRight);
    setRightRev(oldLeft);
    setLeftLabel(oldRightLabel);
    setRightLabel(oldLeftLabel);
    if (diffEditorRef.current && originalModelRef.current && modifiedModelRef.current) {
      diffEditorRef.current.setModel({
        original: modifiedModelRef.current,
        modified: originalModelRef.current,
      });
    }
  };

  const handleModeChange = (newMode: SvnDiffMode) => {
    setMode(newMode);
    // Auto-fill sensible defaults
    if (newMode === 'local-base') {
      setLeftRev('BASE');
      setRightRev('WORKING');
    } else if (newMode === 'local-head') {
      setLeftRev('HEAD');
      setRightRev('WORKING');
    } else if (newMode === 'local-rev') {
      setLeftRev('HEAD');
      setRightRev('WORKING');
    } else if (newMode === 'rev-rev') {
      setLeftRev('BASE');
      setRightRev('HEAD');
    }
  };

  const handlePickLeft = async () => {
    const rev = await onPickRevision('left');
    if (rev !== undefined) {
      setLeftRev(String(rev));
    }
  };

  const handlePickRight = async () => {
    const rev = await onPickRevision('right');
    if (rev !== undefined) {
      setRightRev(String(rev));
    }
  };

  const showRevPicker = mode === 'local-rev' || mode === 'rev-rev';

  return (
    <div className="kairo-svn-diff-widget-root" style={styles.root}>
      <div style={styles.toolbar}>
        <select
          value={mode}
          onChange={e => handleModeChange(e.target.value as SvnDiffMode)}
          style={styles.select}
          aria-label="Compare mode"
        >
          <option value="local-base">Local ↔ BASE</option>
          <option value="local-head">Local ↔ HEAD</option>
          <option value="local-rev">Local ↔ Revision…</option>
          <option value="rev-rev">Revision ↔ Revision</option>
        </select>
        <input
          style={{ ...styles.input, flex: '1 1 200px', minWidth: '180px' }}
          value={filePath}
          onChange={e => setFilePath(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleShowDiff(); }}
          placeholder="File path relative to WC root (e.g. src/main/java/Hello.java)"
          aria-label="File path"
        />
        <span style={styles.at}>@</span>
        <input
          style={{ ...styles.input, width: '100px' }}
          value={leftRev}
          onChange={e => setLeftRev(e.target.value)}
          placeholder="BASE / HEAD / r123"
          aria-label="Left revision"
        />
        {showRevPicker && (
          <button style={styles.pickBtn} onClick={handlePickLeft} title="Pick from history">…</button>
        )}
        <span style={styles.colon}>↔</span>
        <input
          style={{ ...styles.input, width: '100px' }}
          value={rightRev}
          onChange={e => setRightRev(e.target.value)}
          placeholder="WORKING / HEAD / r123"
          aria-label="Right revision"
        />
        {showRevPicker && (
          <button style={styles.pickBtn} onClick={handlePickRight} title="Pick from history">…</button>
        )}
        <button style={styles.swapBtn} onClick={handleSwap} title="Swap left and right">⇄</button>
        <button style={styles.goBtn} onClick={handleShowDiff} disabled={loading}>
          {loading ? 'Loading…' : 'Show Diff'}
        </button>
      </div>

      {error && (
        <div style={styles.errorBanner}>
          ⚠️ {error}
        </div>
      )}

      <div style={styles.statusBar} data-testid="svn-diff-status">
        <span style={styles.statusItem}>
          {leftLabel ? `Left: ${leftLabel}` : mode === 'local-base' || mode === 'local-head' || mode === 'local-rev' ? `Left: r${leftRev}` : `Left: r${leftRev}`}
        </span>
        <span style={styles.statusItem}>
          {rightLabel ? `Right: ${rightLabel}` : 'Right: working copy'}
        </span>
        {!available && (
          <span style={{ ...styles.statusItem, color: 'var(--theia-editorError-foreground)' }}>
            ⚠️ SVN client not available
          </span>
        )}
      </div>

      <div ref={containerRef} style={styles.editorContainer} data-testid="svn-diff-editor" />

      <style>{`
        .kairo-svn-diff-widget-root .monaco-diff-editor .editor.original {
          border-right: 1px solid var(--theia-editorIndentGuide-background1, #444);
        }
      `}</style>
    </div>
  );
};

const styles: { [k: string]: React.CSSProperties } = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: 'var(--theia-editor-background)',
    color: 'var(--theia-editor-foreground)',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
    padding: '6px 8px',
    borderBottom: '1px solid var(--theia-dropdown-border)',
    backgroundColor: 'var(--theia-editorWidget-background)',
  },
  select: {
    padding: '3px 6px',
    backgroundColor: 'var(--theia-input-background)',
    color: 'var(--theia-input-foreground)',
    border: '1px solid var(--theia-input-border)',
    borderRadius: '2px',
    fontSize: '12px',
  },
  input: {
    padding: '3px 8px',
    backgroundColor: 'var(--theia-input-background)',
    color: 'var(--theia-input-foreground)',
    border: '1px solid var(--theia-input-border)',
    borderRadius: '2px',
    fontSize: '12px',
  },
  at: { fontSize: '12px', color: 'var(--theia-descriptionForeground)' },
  colon: { fontSize: '12px', color: 'var(--theia-descriptionForeground)' },
  pickBtn: {
    padding: '2px 8px',
    backgroundColor: 'var(--theia-button-secondaryBackground)',
    color: 'var(--theia-button-secondaryForeground)',
    border: '1px solid var(--theia-button-border)',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  swapBtn: {
    padding: '3px 10px',
    backgroundColor: 'var(--theia-button-secondaryBackground)',
    color: 'var(--theia-button-secondaryForeground)',
    border: '1px solid var(--theia-button-border)',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  goBtn: {
    padding: '4px 14px',
    backgroundColor: 'var(--theia-button-background)',
    color: 'var(--theia-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
  },
  errorBanner: {
    padding: '6px 10px',
    color: 'var(--theia-errorForeground)',
    backgroundColor: 'var(--theia-inputValidation-errorBackground)',
    borderBottom: '1px solid var(--theia-inputValidation-errorBorder)',
    fontSize: '12px',
  },
  statusBar: {
    display: 'flex',
    gap: '16px',
    padding: '3px 10px',
    fontSize: '11px',
    color: 'var(--theia-descriptionForeground)',
    backgroundColor: 'var(--theia-statusBar-background)',
    borderBottom: '1px solid var(--theia-dropdown-border)',
  },
  statusItem: {
    fontFamily: 'var(--theia-editor-font-family, monospace)',
  },
  editorContainer: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
};

function detectLanguageFromPath(path: string): string {
  const ext = path.toLowerCase().split('.').pop() || '';
  const map: { [k: string]: string } = {
    java: 'java', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', xml: 'xml', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
    py: 'python', rb: 'ruby', php: 'php', go: 'go', rs: 'rust', c: 'c', h: 'c',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp', sh: 'shell', bash: 'shell',
    zsh: 'shell', yml: 'yaml', yaml: 'yaml', md: 'markdown', sql: 'sql', properties: 'properties',
    jsp: 'html', jspf: 'html', kt: 'kotlin', kts: 'kotlin', swift: 'swift', m: 'objective-c',
  };
  return map[ext] || 'plaintext';
}

async function readWorkingCopyContent(
  fileService: FileService,
  workspaceService: WorkspaceService,
  wcRoot: string,
  relPath: string,
): Promise<string> {
  // Build the workspace-relative URI of the file
  const fileUriStr = (wcRoot.endsWith('/') ? wcRoot : wcRoot + '/') + relPath;
  // Use FileService to read the current working copy file
  // Lazy import to avoid top-level cost
  const { URI } = await import('@theia/core/lib/common/uri');
  const fileUri = new URI('file://' + fileUriStr);
  try {
    const data = await fileService.read(fileUri);
    if (typeof data.value === 'string') return data.value;
    // Binary: try decode as UTF-8
    return new TextDecoder('utf-8', { fatal: false }).decode(data.value);
  } catch {
    return '';
  }
}

@injectable()
export class SvnDiffWidget extends ReactWidget {
  static readonly ID = 'kairo-svn-diff-widget';
  static readonly LABEL = 'SVN Diff';

  @inject(SvnService) protected readonly svnService!: SvnService;
  @inject(FileService) protected readonly fileService!: FileService;
  @inject(QuickInputService) protected readonly quickInputService!: QuickInputService;
  @inject(MessageService) protected readonly messageService!: MessageService;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;

  protected filePath: string = '';
  protected baseRevision: string | number = 'BASE';
  protected targetRevision: string | number = 'HEAD';
  protected mode: SvnDiffMode = 'local-base';

  constructor() {
    super();
    this.id = SvnDiffWidget.ID;
    this.title.label = SvnDiffWidget.LABEL;
    this.title.caption = SvnDiffWidget.LABEL;
    this.title.iconClass = 'codicon codicon-diff';
    this.title.closable = true;
    this.addClass('kairo-svn-diff-widget');
  }

  /**
   * Clear the current diff target. Called when the active SVN working
   * copy changes so the widget does not display stale content from
   * the previous project.
   */
  reset(): void {
    this.filePath = '';
    this.baseRevision = 'BASE';
    this.targetRevision = 'HEAD';
    this.mode = 'local-base';
    this.title.label = SvnDiffWidget.LABEL;
    this.title.caption = SvnDiffWidget.LABEL;
    this.update();
  }

  setDiffTarget(filePath: string, baseRevision?: string | number, targetRevision?: string | number): void {
    this.filePath = filePath;
    if (baseRevision !== undefined) {
      this.baseRevision = baseRevision;
      this.mode = targetRevision !== undefined ? 'rev-rev' : 'local-rev';
    }
    if (targetRevision !== undefined) {
      this.targetRevision = targetRevision;
    }
    const baseName = filePath.split(/[\\/]/).pop() || filePath;
    this.title.label = `SVN Diff: ${baseName}`;
    this.update();
  }

  setMode(mode: SvnDiffMode): void {
    this.mode = mode;
    this.update();
  }

  protected render(): React.ReactNode {
    const component = React.createElement(SvnDiffComponent, {
      svnService: this.svnService,
      fileService: this.fileService,
      quickInputService: this.quickInputService,
      messageService: this.messageService,
      workspaceService: this.workspaceService,
      initialFilePath: this.filePath,
      initialBaseRevision: this.baseRevision,
      initialTargetRevision: this.targetRevision,
      onPickRevision: this.handlePickRevision.bind(this),
      onLoadDiff: this.handleLoadDiff.bind(this),
    });
    return component;
  }

  protected async handlePickRevision(target: 'left' | 'right'): Promise<string | number | undefined> {
    if (!this.filePath) {
      this.messageService.warn('Enter a file path first to load its history');
      return undefined;
    }
    try {
      const entries: SvnLogEntry[] = await this.svnService.getLog(this.filePath, { limit: 200 });
      if (entries.length === 0) {
        this.messageService.warn('No history available for this file');
        return undefined;
      }
      interface RevPickItem { label: string; description?: string; rev: number | string; }
      const items: RevPickItem[] = entries.map(e => ({
        label: `r${e.revision} — ${(e.message || '(no message)').split('\n')[0].slice(0, 60)}`,
        description: `${e.author} · ${e.date.toLocaleString()}`,
        rev: e.revision,
      }));
      // Allow special keywords
      items.unshift({ label: 'BASE (last committed)', rev: 'BASE' });
      items.unshift({ label: 'HEAD (latest)', rev: 'HEAD' });
      items.unshift({ label: 'PREV (previous to BASE)', rev: 'PREV' });
      items.unshift({ label: 'COMMITTED (last commit affecting this path)', rev: 'COMMITTED' });
      const selected = await this.quickInputService.showQuickPick(items, {
        placeholder: `Pick ${target} revision (${this.filePath})`,
      });
      return selected?.rev;
    } catch (e) {
      this.messageService.error(`Failed to load history: ${(e as Error).message}`);
      return undefined;
    }
  }

  protected async handleLoadDiff(
    filePath: string,
    mode: SvnDiffMode,
    left: string | number,
    right: string | number,
  ): Promise<{ leftContent: string; rightContent: string; leftLabel: string; rightLabel: string }> {
    const wcRoot = this.svnService.getActiveWcRoot();
    if (!wcRoot) {
      this.messageService.warn('No active SVN working copy');
      return { leftContent: '', rightContent: '', leftLabel: '', rightLabel: '' };
    }

    const isSpecialLeft = (v: string | number) => typeof v === 'string' && /^(BASE|HEAD|PREV|COMMITTED|WORKING)$/i.test(v);
    const isSpecialRight = (v: string | number) => typeof v === 'string' && /^(BASE|HEAD|PREV|COMMITTED|WORKING)$/i.test(v);

    const resolveLeft = async (): Promise<{ content: string; label: string }> => {
      if (mode === 'local-base' || mode === 'local-head' || mode === 'local-rev' || isSpecialLeft(left)) {
        // Left side is from a SVN revision
        const rev = String(left);
        const content = await this.svnService.getFileAtRevision(filePath, rev);
        return { content, label: `r${rev} from repository` };
      }
      // rev-rev mode: also from repository
      const rev = String(left);
      const content = await this.svnService.getFileAtRevision(filePath, rev);
      return { content, label: `r${rev} from repository` };
    };

    const resolveRight = async (): Promise<{ content: string; label: string }> => {
      // In any "local-*" mode, right side is the working copy file
      if (mode === 'local-base' || mode === 'local-head' || mode === 'local-rev') {
        const content = await readWorkingCopyContent(this.fileService, this.workspaceService, wcRoot, filePath);
        return { content, label: 'working copy' };
      }
      // rev-rev mode: right side is from repository
      const rev = String(right);
      const content = await this.svnService.getFileAtRevision(filePath, rev);
      return { content, label: `r${rev} from repository` };
    };

    const [leftResult, rightResult] = await Promise.all([resolveLeft(), resolveRight()]);
    return {
      leftContent: leftResult.content,
      rightContent: rightResult.content,
      leftLabel: leftResult.label,
      rightLabel: rightResult.label,
    };
  }
}
