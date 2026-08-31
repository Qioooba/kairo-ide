import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator';
import { WidgetDecoration } from '@theia/core/lib/browser/widget-decoration';
import { Emitter, Event, DisposableCollection } from '@theia/core/lib/common';
import { Title, Widget } from '@theia/core/shared/@lumino/widgets';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { SvnService } from './svn-service';
import { SvnFileStatus } from '../common/svn-types';
import { toWcRelativeFromUri } from '../common/svn-path-utils';

const STATUS_COLORS: Record<SvnFileStatus, string> = {
  [SvnFileStatus.Normal]: '',
  [SvnFileStatus.Modified]: 'var(--theia-gitDecoration-modifiedResourceForeground)',
  [SvnFileStatus.Added]: 'var(--theia-gitDecoration-addedResourceForeground)',
  [SvnFileStatus.Deleted]: 'var(--theia-gitDecoration-deletedResourceForeground)',
  [SvnFileStatus.Conflict]: 'var(--theia-gitDecoration-conflictingResourceForeground)',
  [SvnFileStatus.Missing]: 'var(--theia-editorError-foreground)',
  [SvnFileStatus.Unversioned]: 'var(--theia-gitDecoration-untrackedResourceForeground)',
  [SvnFileStatus.Ignored]: 'var(--theia-gitDecoration-ignoredResourceForeground)',
  [SvnFileStatus.Replaced]: 'var(--theia-textLink-foreground)',
  [SvnFileStatus.Obstructed]: 'var(--theia-editorWarning-foreground)',
  [SvnFileStatus.Locked]: 'var(--theia-editorWarning-foreground)',
  [SvnFileStatus.Switched]: 'var(--theia-textLink-foreground)',
  [SvnFileStatus.External]: 'var(--theia-descriptionForeground)',
  [SvnFileStatus.None]: '',
};

const STATUS_LABELS: Record<SvnFileStatus, string> = {
  [SvnFileStatus.Normal]: '',
  [SvnFileStatus.Modified]: 'M',
  [SvnFileStatus.Added]: 'A',
  [SvnFileStatus.Deleted]: 'D',
  [SvnFileStatus.Conflict]: '!',
  [SvnFileStatus.Missing]: '!',
  [SvnFileStatus.Unversioned]: '?',
  [SvnFileStatus.Ignored]: 'I',
  [SvnFileStatus.Replaced]: 'R',
  [SvnFileStatus.Obstructed]: '~',
  [SvnFileStatus.Locked]: 'L',
  [SvnFileStatus.Switched]: 'S',
  [SvnFileStatus.External]: 'X',
  [SvnFileStatus.None]: '',
};

@injectable()
export class SvnFileStatusDecorator implements TabBarDecorator {
  readonly id = 'kairo-svn-file-status-decorator';

  @inject(EditorManager) protected editorManager!: EditorManager;
  @inject(SvnService) protected svnService!: SvnService;

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
      this.svnService.onDidChangeStatus(() => {
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

    const wcRoot = this.svnService.getActiveWcRoot();
    if (!wcRoot) return [];

    const uriStr = uri.toString();
    let relativePath: string | undefined;
    if (uriStr.startsWith('file:')) {
      relativePath = toWcRelativeFromUri(uriStr, wcRoot);
    }

    if (relativePath === undefined || relativePath === '') return [];

    const fileStatus = this.svnService.getFileStatus(relativePath);
    if (!fileStatus) return [];

    const status = fileStatus.status;
    const label = STATUS_LABELS[status];
    const color = STATUS_COLORS[status];

    if (!label || !color) return [];

    return [{
      captionSuffixes: [{
        // Colored dot (same idea as explorer) — avoid M/A/? letters on tabs.
        data: ' \u25CF',
        fontData: { color },
      }],
      tooltip: `SVN: ${this.statusTooltip(status)}`,
    }];
  }

  protected statusTooltip(status: SvnFileStatus): string {
    switch (status) {
      case SvnFileStatus.Modified: return 'Modified';
      case SvnFileStatus.Added: return 'Added';
      case SvnFileStatus.Deleted: return 'Deleted';
      case SvnFileStatus.Conflict: return 'Conflict';
      case SvnFileStatus.Missing: return 'Missing';
      case SvnFileStatus.Unversioned: return 'Unversioned';
      case SvnFileStatus.Ignored: return 'Ignored';
      case SvnFileStatus.Replaced: return 'Replaced';
      case SvnFileStatus.Obstructed: return 'Obstructed';
      case SvnFileStatus.Locked: return 'Locked';
      case SvnFileStatus.Switched: return 'Switched';
      case SvnFileStatus.External: return 'External';
      default: return '';
    }
  }
}
