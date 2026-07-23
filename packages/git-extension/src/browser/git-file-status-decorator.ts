import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator';
import { WidgetDecoration } from '@theia/core/lib/browser/widget-decoration';
import { Emitter, Event, DisposableCollection } from '@theia/core/lib/common';
import { Title, Widget } from '@theia/core/shared/@lumino/widgets';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { GitService } from './git-service';

const STATUS_COLORS: Record<string, string> = {
  M: 'var(--theia-editorWarning-foreground)',
  A: 'var(--theia-editorSuccess-foreground)',
  D: 'var(--theia-editorError-foreground)',
  R: 'var(--theia-textLink-foreground)',
  C: 'var(--theia-textLink-foreground)',
  U: 'var(--theia-editorError-foreground)',
  '?': 'var(--theia-descriptionForeground)',
};

const STATUS_LABELS: Record<string, string> = {
  M: 'M',
  A: 'A',
  D: 'D',
  R: 'R',
  C: 'C',
  U: 'U',
  '?': '?',
};

@injectable()
export class GitFileStatusDecorator implements TabBarDecorator {
  readonly id = 'kairo-git-file-status-decorator';

  @inject(EditorManager) protected editorManager!: EditorManager;
  @inject(GitService) protected gitService!: GitService;

  protected readonly onDidChangeDecorationsEmitter = new Emitter<void>();
  readonly onDidChangeDecorations: Event<void> = this.onDidChangeDecorationsEmitter.event;

  protected toDispose = new DisposableCollection();

  @postConstruct()
  protected init(): void {
    this.toDispose.push(
      this.editorManager.onCurrentEditorChanged(() => {
        this.onDidChangeDecorationsEmitter.fire();
      }),
    );
    this.toDispose.push(
      this.gitService.onDidChangeStatus(() => {
        this.onDidChangeDecorationsEmitter.fire();
      }),
    );
  }

  dispose(): void {
    this.toDispose.dispose();
    this.onDidChangeDecorationsEmitter.dispose();
  }

  decorate(title: Title<Widget>): WidgetDecoration.Data[] {
    const editorWidget = this.editorManager.currentEditor;
    if (!editorWidget) return [];
    if (title.owner !== editorWidget) return [];

    const editor = editorWidget.editor;
    const uri = editor.document.uri;
    if (!uri) return [];

    const repoRoot = this.gitService.getRepoRoot();
    if (!repoRoot) return [];

    const uriStr = uri.toString();
    let relativePath: string | undefined;
    if (uriStr.startsWith('file://')) {
      const filePath = decodeURIComponent(uriStr.replace('file://', ''));
      if (filePath.startsWith(repoRoot)) {
        relativePath = filePath.substring(repoRoot.length + 1);
      }
    }

    if (!relativePath) return [];

    const fileStatus = this.gitService.getFileStatus(relativePath);
    if (!fileStatus) return [];

    const status = fileStatus.status;
    const label = STATUS_LABELS[status];
    const color = STATUS_COLORS[status] || 'var(--theia-descriptionForeground)';

    if (!label) return [];

    return [{
      captionSuffixes: [{
        data: ` ${label}`,
        fontData: { color },
      }],
      tooltip: `Git: ${this.statusTooltip(status)}`,
    }];
  }

  protected statusTooltip(status: string): string {
    switch (status) {
      case 'M': return 'Modified';
      case 'A': return 'Added';
      case 'D': return 'Deleted';
      case 'R': return 'Renamed';
      case 'C': return 'Copied';
      case 'U': return 'Unmerged';
      case '?': return 'Untracked';
      default: return status;
    }
  }
}