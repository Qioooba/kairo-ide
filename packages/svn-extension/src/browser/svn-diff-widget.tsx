// SPDX-License-Identifier: Apache-2.0
//
// Kairo SVN Diff Widget - IDEA-style side-by-side diff using Monaco's
// built-in DiffEditor. Supports:
//   - Local vs BASE
//   - Local vs HEAD
//   - Local vs Revision (with revision picker via QuickPick)
//   - Revision A vs Revision B (with two revision pickers)
//
// Provides character-level inline highlights, minimap, prev/next diff
// navigation, and synchronized scrolling - all from Monaco out of the box.

import * as React from 'react';
import * as monaco from '@theia/monaco-editor-core';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KairoI18nService } from '@kairo/i18n';
import { MessageService } from '@theia/core/lib/common/message-service';
import { QuickInputService } from '@theia/core/lib/browser/quick-input/quick-input-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { SvnService } from './svn-service';
import { SvnLogEntry } from '../common/svn-types';

export type SvnDiffMode = 'local-base' | 'local-head' | 'local-rev' | 'rev-rev';

interface SvnDiffComponentProps {
  svnService: SvnService;
  fileService: FileService;
  quickInputService: QuickInputService;
  messageService: MessageService;
  workspaceService: WorkspaceService;
  i18n: KairoI18nService;
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
    i18n,
    initialFilePath,
    initialBaseRevision,
    initialTargetRevision,
    onPickRevision,
    onLoadDiff,
  } = props;

  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);

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
      setError(t('widget.svn.diff.error.enterFilePath'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await onLoadDiff(fp, md, l, r);
      if (!result.leftContent && !result.rightContent) {
        setError(t('widget.svn.diff.error.noDiffContent'));
      } else {
        applyModels(result.leftContent, result.rightContent, fp);
        setLeftLabel(result.leftLabel);
        setRightLabel(result.rightLabel);
      }
    } catch (e) {
      setError(t('widget.svn.diff.error.loadFailed', { message: (e as Error).message || t('common.unknown') }));
    } finally {
      setLoading(false);
    }
  }, [onLoadDiff, applyModels, t]);

  // Auto-load when initial values provided
  React.useEffect(() => {
    if (initialFilePath) {
      void loadAndApply(initialFilePath, mode, leftRev, rightRev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleShowDiff = () => {
    if (!filePath) {
      messageService.warn(t('widget.svn.diff.enterFilePathFirst'));
      return;
    }
    void loadAndApply(filePath, mode, leftRev, rightRev);
  };

  const handleSwap = () => {
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
    <div className="kairo-widget kairo-svn-diff-widget">
      <div className="kairo-widget-header">
        <span className="kairo-widget-title">{t('widget.svn.diff.title')}</span>
      </div>

      <div className="kairo-widget-toolbar kairo-svn-diff-toolbar">
        <select
          value={mode}
          onChange={e => handleModeChange(e.target.value as SvnDiffMode)}
          className="kairo-svn-diff-mode-select"
          aria-label={t('widget.svn.diff.mode.label')}
        >
          <option value="local-base">{t('widget.svn.diff.mode.localBase')}</option>
          <option value="local-head">{t('widget.svn.diff.mode.localHead')}</option>
          <option value="local-rev">{t('widget.svn.diff.mode.localRev')}</option>
          <option value="rev-rev">{t('widget.svn.diff.mode.revRev')}</option>
        </select>
        <input
          className="kairo-svn-diff-input kairo-svn-diff-input--file"
          value={filePath}
          onChange={e => setFilePath(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleShowDiff(); }}
          placeholder={t('widget.svn.diff.filePathPlaceholder')}
          aria-label={t('widget.svn.diff.filePathAria')}
        />
        <span className="kairo-svn-diff-separator">@</span>
        <input
          className="kairo-svn-diff-input kairo-svn-diff-input--rev"
          value={leftRev}
          onChange={e => setLeftRev(e.target.value)}
          placeholder={t('widget.svn.diff.leftRevisionPlaceholder')}
          aria-label={t('widget.svn.diff.leftRevisionAria')}
        />
        {showRevPicker && (
          <button
            className="theia-button secondary kairo-svn-diff-pick-btn"
            onClick={handlePickLeft}
            title={t('widget.svn.diff.pickRevisionTooltip')}
            aria-label={t('widget.svn.diff.pickRevisionTooltip')}
          >
            <span className="codicon codicon-ellipsis" aria-hidden="true" />
          </button>
        )}
        <span className="kairo-svn-diff-separator">
          <span className="codicon codicon-arrow-swap" aria-hidden="true" />
        </span>
        <input
          className="kairo-svn-diff-input kairo-svn-diff-input--rev"
          value={rightRev}
          onChange={e => setRightRev(e.target.value)}
          placeholder={t('widget.svn.diff.rightRevisionPlaceholder')}
          aria-label={t('widget.svn.diff.rightRevisionAria')}
        />
        {showRevPicker && (
          <button
            className="theia-button secondary kairo-svn-diff-pick-btn"
            onClick={handlePickRight}
            title={t('widget.svn.diff.pickRevisionTooltip')}
            aria-label={t('widget.svn.diff.pickRevisionTooltip')}
          >
            <span className="codicon codicon-ellipsis" aria-hidden="true" />
          </button>
        )}
        <button
          className="theia-button secondary kairo-svn-diff-swap-btn"
          onClick={handleSwap}
          title={t('widget.svn.diff.swapTooltip')}
          aria-label={t('widget.svn.diff.swapTooltip')}
        >
          <span className="codicon codicon-arrow-swap" aria-hidden="true" />
        </button>
        <button
          className="theia-button primary kairo-svn-diff-go-btn"
          onClick={handleShowDiff}
          disabled={loading}
        >
          <span className={`codicon ${loading ? 'codicon-loading codicon-modifier-spin' : 'codicon-diff'}`} aria-hidden="true" />
          {loading ? t('widget.svn.diff.loading') : t('widget.svn.diff.showDiff')}
        </button>
      </div>

      {error && (
        <div className="kairo-error-banner" role="alert">
          <span className="codicon codicon-warning" aria-hidden="true" />
          {error}
        </div>
      )}

      <div className="kairo-svn-diff-status-bar" data-testid="svn-diff-status">
        <span className="kairo-svn-diff-status-item">
          {leftLabel
            ? t('widget.svn.diff.status.leftLabel', { label: leftLabel })
            : t('widget.svn.diff.status.leftRev', { rev: leftRev })}
        </span>
        <span className="kairo-svn-diff-status-item">
          {rightLabel
            ? t('widget.svn.diff.status.rightLabel', { label: rightLabel })
            : t('widget.svn.diff.status.rightWorkingCopy')}
        </span>
        {!available && (
          <span className="kairo-svn-diff-status-item kairo-svn-diff-status-item--error">
            <span className="codicon codicon-warning" aria-hidden="true" />
            {t('widget.svn.diff.status.svnNotAvailable')}
          </span>
        )}
      </div>

      <div ref={containerRef} className="kairo-svn-diff-editor" data-testid="svn-diff-editor" />
    </div>
  );
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
  @inject(KairoI18nService) protected readonly i18n!: KairoI18nService;

  protected filePath: string = '';
  protected baseRevision: string | number = 'BASE';
  protected targetRevision: string | number = 'HEAD';
  protected mode: SvnDiffMode = 'local-base';

  constructor() {
    super();
    this.id = SvnDiffWidget.ID;
    this.title.iconClass = 'codicon codicon-diff';
    this.title.closable = true;
    this.addClass('kairo-svn-diff-widget');
  }

  @postConstruct()
  protected init(): void {
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
  }

  protected updateTitle(): void {
    this.title.caption = this.i18n.t('widget.svn.diff.caption' as any);
    if (!this.filePath) {
      this.title.label = this.i18n.t('widget.svn.diff.title' as any);
    } else {
      const name = this.filePath.split(/[\\/]/).pop() || this.filePath;
      this.title.label = this.i18n.t('widget.svn.diff.titleWithFile' as any, { name });
    }
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
    this.updateTitle();
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
    this.updateTitle();
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
      i18n: this.i18n,
      initialFilePath: this.filePath,
      initialBaseRevision: this.baseRevision,
      initialTargetRevision: this.targetRevision,
      onPickRevision: this.handlePickRevision.bind(this),
      onLoadDiff: this.handleLoadDiff.bind(this),
    });
    return component;
  }

  protected async handlePickRevision(target: 'left' | 'right'): Promise<string | number | undefined> {
    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key as any, params);
    if (!this.filePath) {
      this.messageService.warn(t('widget.svn.diff.enterFilePathFirst'));
      return undefined;
    }
    try {
      const entries: SvnLogEntry[] = await this.svnService.getLog(this.filePath, { limit: 200 });
      if (entries.length === 0) {
        this.messageService.warn(t('widget.svn.diff.noHistoryForFile'));
        return undefined;
      }
      interface RevPickItem { label: string; description?: string; rev: number | string; }
      const items: RevPickItem[] = entries.map(e => ({
        label: `r${e.revision} - ${(e.message || t('widget.svn.diff.noMessage')).split('\n')[0].slice(0, 60)}`,
        description: `${e.author} | ${e.date.toLocaleString()}`,
        rev: e.revision,
      }));
      // Allow special keywords
      items.unshift({ label: t('widget.svn.diff.revBase'), rev: 'BASE' });
      items.unshift({ label: t('widget.svn.diff.revHead'), rev: 'HEAD' });
      items.unshift({ label: t('widget.svn.diff.revPrev'), rev: 'PREV' });
      items.unshift({ label: t('widget.svn.diff.revCommitted'), rev: 'COMMITTED' });
      const selected = await this.quickInputService.showQuickPick(items, {
        placeholder: t('widget.svn.diff.pickRevisionPlaceholder', { target, path: this.filePath }),
      });
      return selected?.rev;
    } catch (e) {
      this.messageService.error(t('widget.svn.diff.loadHistoryFailed', { message: (e as Error).message }));
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
      this.messageService.warn(this.i18n.t('widget.svn.diff.noActiveWorkingCopy' as any));
      return { leftContent: '', rightContent: '', leftLabel: '', rightLabel: '' };
    }

    const isSpecialLeft = (v: string | number) => typeof v === 'string' && /^(BASE|HEAD|PREV|COMMITTED|WORKING)$/i.test(v);
    const isSpecialRight = (v: string | number) => typeof v === 'string' && /^(BASE|HEAD|PREV|COMMITTED|WORKING)$/i.test(v);

    const t = (key: string, params?: Record<string, string | number>) => this.i18n.t(key as any, params);

    const resolveLeft = async (): Promise<{ content: string; label: string }> => {
      const rev = String(left);
      const content = await this.svnService.getFileAtRevision(filePath, rev);
      return { content, label: t('widget.svn.diff.status.repositoryRev', { rev }) };
    };

    const resolveRight = async (): Promise<{ content: string; label: string }> => {
      // In any "local-*" mode, right side is the working copy file
      if (mode === 'local-base' || mode === 'local-head' || mode === 'local-rev') {
        const content = await readWorkingCopyContent(this.fileService, this.workspaceService, wcRoot, filePath);
        return { content, label: t('widget.svn.diff.status.workingCopy') };
      }
      // rev-rev mode: right side is from repository
      const rev = String(right);
      const content = await this.svnService.getFileAtRevision(filePath, rev);
      return { content, label: t('widget.svn.diff.status.repositoryRev', { rev }) };
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
