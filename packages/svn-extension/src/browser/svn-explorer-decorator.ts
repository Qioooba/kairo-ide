import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { TreeDecorator } from '@theia/core/lib/browser/tree/tree-decorator';
import { Tree, TreeNode, CompositeTreeNode } from '@theia/core/lib/browser/tree';
import { Emitter, Event, MaybePromise } from '@theia/core/lib/common';
import { WidgetDecoration } from '@theia/core/lib/browser/widget-decoration';
import { SvnService } from './svn-service';
import { SvnFileStatus } from './svn-types';

interface FileNode extends TreeNode {
  uri?: string | { path?: { toString(): string }; toString(): string };
  fileStat?: { resource?: { path?: { toString(): string } } };
}

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
export class SvnExplorerDecorator implements TreeDecorator {
  readonly id = 'kairo-svn-explorer-decorator';

  @inject(SvnService) protected svnService!: SvnService;

  protected readonly emitter = new Emitter<(tree: Tree) => Map<string, WidgetDecoration.Data>>();
  readonly onDidChangeDecorations: Event<(tree: Tree) => Map<string, WidgetDecoration.Data>> = this.emitter.event;

  @postConstruct()
  protected init(): void {
    this.svnService.onDidChangeStatus(() => {
      this.emitter.fire(tree => this.computeDecorations(tree));
    });
  }

  decorations(tree: Tree): MaybePromise<Map<string, WidgetDecoration.Data>> {
    return this.computeDecorations(tree);
  }

  protected computeDecorations(tree: Tree): Map<string, WidgetDecoration.Data> {
    const result = new Map<string, WidgetDecoration.Data>();
    const wcRoot = this.svnService.getActiveWcRoot();
    if (!wcRoot) return result;

    const statusEntries = this.svnService.getCachedStatus();
    if (!statusEntries || statusEntries.length === 0) return result;

    const statusMap = new Map<string, SvnFileStatus>();
    for (const entry of statusEntries) {
      if (entry.status !== SvnFileStatus.Normal && entry.status !== SvnFileStatus.None) {
        statusMap.set(entry.path.replace(/\\/g, '/'), entry.status);
      }
    }

    for (const node of this.collectNodes(tree.root)) {
      const filePath = this.getFilePath(node);
      if (!filePath) continue;

      let relative: string | undefined;
      if (filePath.startsWith('file://')) {
        relative = decodeURIComponent(filePath.replace('file://', ''));
        if (relative.startsWith(wcRoot)) {
          relative = relative.substring(wcRoot.length + 1).replace(/\\/g, '/');
        } else {
          continue;
        }
      } else if (filePath.startsWith(wcRoot)) {
        relative = filePath.substring(wcRoot.length + 1).replace(/\\/g, '/');
      } else if (!filePath.startsWith('/')) {
        relative = filePath.replace(/\\/g, '/');
      } else {
        continue;
      }

      let status: SvnFileStatus | undefined;
      if (statusMap.has(relative)) {
        status = statusMap.get(relative);
      } else {
        for (const [p] of statusMap) {
          if (p.startsWith(relative + '/')) {
            status = SvnFileStatus.Modified;
            break;
          }
        }
      }

      if (!status || status === SvnFileStatus.Normal || status === SvnFileStatus.None) continue;

      const color = STATUS_COLORS[status];
      const label = STATUS_LABELS[status];

      result.set(node.id, {
        fontData: { color },
        captionSuffixes: label ? [{ data: ` ${label}`, fontData: { color } }] : undefined,
      });
    }

    return result;
  }

  protected *collectNodes(node: TreeNode | undefined): Generator<TreeNode> {
    if (!node) return;
    yield node;
    const children = CompositeTreeNode.is(node) ? node.children : undefined;
    if (Array.isArray(children)) {
      for (const child of children) {
        yield* this.collectNodes(child);
      }
    }
  }

  protected getFilePath(node: TreeNode): string | undefined {
    const n = node as FileNode;
    if (n.uri) {
      if (typeof n.uri === 'string') return n.uri;
      if (n.uri.path) return n.uri.path.toString();
      if (n.uri.toString) return n.uri.toString();
    }
    if (n.fileStat?.resource?.path) {
      return n.fileStat.resource.path.toString();
    }
    if (n.id) {
      return n.id;
    }
    return undefined;
  }
}
