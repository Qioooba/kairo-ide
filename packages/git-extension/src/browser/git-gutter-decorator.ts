import { injectable, inject } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser';
import { Emitter } from '@theia/core/lib/common/event';
import { DisposableCollection } from '@theia/core';
import {
  FrontendApplication,
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import type { editor as MonacoEditorTypes } from '@theia/monaco-editor-core';
import { GitService } from './git-service';
import { toRepoRelativePath } from '../common/git-path-utils';

type MonacoControlLike = MonacoEditorTypes.IStandaloneCodeEditor;
type GutterDecoration = MonacoEditorTypes.IModelDeltaDecoration;

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

/**
 * Dirty-diff gutter marks for modified files (IDEA-style).
 * Mirrors SvnGutterDecorator; adds the missing glyphMargin CSS so marks
 * are actually visible.
 */
@injectable()
export class GitGutterDecorator implements FrontendApplicationContribution {
  @inject(EditorManager) protected readonly editorManager!: EditorManager;
  @inject(GitService) protected readonly gitService!: GitService;

  protected readonly onDidChangeDecorationsEmitter = new Emitter<void>();
  readonly onDidChangeDecorations = this.onDidChangeDecorationsEmitter.event;

  protected currentDecorations: Map<string, { clear(): void }> = new Map();
  protected storeGeneration = 0;
  protected diffCache = new Map<string, { storeGen: number; versionId: number; decorations: GutterDecoration[] }>();
  protected readonly toDispose = new DisposableCollection();

  onStart(app: FrontendApplication): void {
    void app;
    this.toDispose.push(this.gitService.onDidChangeStatus(() => {
      this.storeGeneration++;
      this.updateCurrentEditorDecorations();
    }));
    this.toDispose.push(this.editorManager.onCurrentEditorChanged(() => {
      this.updateCurrentEditorDecorations();
    }));
  }

  onStop(): void {
    this.toDispose.dispose();
  }

  protected updateCurrentEditorDecorations(): void {
    const editor = this.editorManager.currentEditor;
    if (editor) {
      void this.updateDecorationsForEditor(editor);
    }
  }

  protected async updateDecorationsForEditor(editor: EditorManager['currentEditor']): Promise<void> {
    const monacoEditor = this.getMonacoControl(editor);
    if (!monacoEditor) return;

    const uri = editor?.getResourceUri();
    if (!uri) return;

    const key = uri.toString();
    const repoRoot = this.gitService.getRepoRoot();
    const filePath = repoRoot ? toRepoRelativePath(key, repoRoot) : undefined;
    const model = monacoEditor.getModel();
    if (!model) return;
    const lineCount = model.getLineCount() as number;
    const versionId = (model.getVersionId?.() as number | undefined) ?? -1;
    const entry = filePath ? this.gitService.getFileStatus(filePath) : undefined;
    const cacheKey = `${key}@${entry ? entry.status : 'none'}`;
    const cached = this.diffCache.get(cacheKey);
    if (cached && cached.storeGen === this.storeGeneration && cached.versionId === versionId) {
      this.applyDecorations(monacoEditor, key, cached.decorations);
      return;
    }

    const decorations: GutterDecoration[] = [];
    const status = entry?.status ?? '';

    if (!filePath || !entry) {
      this.diffCache.set(cacheKey, { storeGen: this.storeGeneration, versionId, decorations: [] });
      this.applyDecorations(monacoEditor, key, []);
      return;
    }

    if (status === 'A' || status === '?') {
      for (let i = 1; i <= lineCount; i++) {
        decorations.push(wholeLineDecoration(i, 'git-gutter-added', 'Added'));
      }
    } else if (status === 'D') {
      for (let i = 1; i <= lineCount; i++) {
        decorations.push(wholeLineDecoration(i, 'git-gutter-deleted', 'Deleted'));
      }
    } else if (status === 'M' || status === 'R' || status === 'C' || status === 'U') {
      try {
        const result = await this.gitService.getDiff(filePath);
        const changedLines = collectChangedLines(this.parseUnifiedDiff(result.diff));
        for (const lineNum of changedLines) {
          if (lineNum >= 1 && lineNum <= lineCount) {
            decorations.push(wholeLineDecoration(lineNum, 'git-gutter-modified', 'Modified'));
          }
        }
      } catch {
        // Diff failed — show no marks rather than wrong ones
      }
    }

    this.diffCache.set(cacheKey, { storeGen: this.storeGeneration, versionId, decorations });
    this.applyDecorations(monacoEditor, key, decorations);
  }

  protected applyDecorations(monacoEditor: MonacoControlLike, key: string, decorations: GutterDecoration[]): void {
    const existing = this.currentDecorations.get(key);
    if (existing) {
      existing.clear();
      this.currentDecorations.delete(key);
    }
    if (decorations.length > 0) {
      this.currentDecorations.set(key, monacoEditor.createDecorationsCollection(decorations));
    }
  }

  protected parseUnifiedDiff(diff: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const hunkHeaderRegex = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;
    let currentHunk: DiffHunk | null = null;
    for (const line of diff.split('\n')) {
      const match = line.match(hunkHeaderRegex);
      if (match) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = {
          oldStart: parseInt(match[1], 10),
          oldCount: match[2] ? parseInt(match[2], 10) : 1,
          newStart: parseInt(match[3], 10),
          newCount: match[4] ? parseInt(match[4], 10) : 1,
          lines: [],
        };
      } else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
        currentHunk.lines.push(line);
      }
    }
    if (currentHunk) hunks.push(currentHunk);
    return hunks;
  }

  /**
   * Duck-typed access to the Monaco standalone editor control. Avoids a
   * runtime dependency on @theia/monaco so plain-Node unit tests can load
   * this module without the ESM/CSS loader chain.
   */
  protected getMonacoControl(editor: EditorManager['currentEditor']): MonacoControlLike | undefined {
    const control = (editor as unknown as { getControl?: () => unknown })?.getControl?.();
    const candidate = control as MonacoControlLike | undefined;
    if (
      candidate
      && typeof candidate.getModel === 'function'
      && typeof candidate.createDecorationsCollection === 'function'
    ) {
      return candidate;
    }
    return undefined;
  }
}

function wholeLineDecoration(line: number, className: string, hover: string): GutterDecoration {
  return {
    range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
    options: {
      isWholeLine: true,
      glyphMarginClassName: className,
      glyphMarginHoverMessage: { value: `${hover} in working tree` },
    },
  };
}

function collectChangedLines(hunks: DiffHunk[]): Set<number> {
  const changed = new Set<number>();
  for (const hunk of hunks) {
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.startsWith('+')) {
        changed.add(newLine);
        newLine++;
      } else if (line.startsWith(' ')) {
        newLine++;
      }
      // '-' lines do not advance the new-file cursor
    }
  }
  return changed;
}
