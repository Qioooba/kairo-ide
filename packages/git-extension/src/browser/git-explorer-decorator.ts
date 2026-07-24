import { injectable, inject } from '@theia/core/shared/inversify';
import { TreeDecorator } from '@theia/core/lib/browser/tree/tree-decorator';
import { Tree, TreeNode, CompositeTreeNode } from '@theia/core/lib/browser/tree';
import { Emitter, Event, MaybePromise } from '@theia/core/lib/common';
import { WidgetDecoration } from '@theia/core/lib/browser/widget-decoration';
import { GitService } from './git-service';

/** Extended node shape for file-system-backed tree nodes. */
interface FileNode extends TreeNode {
  uri?: string | { path?: { toString(): string }; toString(): string };
  fileStat?: { resource?: { path?: { toString(): string } } };
}

const STATUS_COLORS: Record<string, string> = {
  M: 'var(--theia-list-warningForeground)',
  A: 'var(--theia-terminal-ansiGreen)',
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
export class GitExplorerDecorator implements TreeDecorator {
  readonly id = 'kairo-git-explorer-decorator';

  @inject(GitService) protected gitService!: GitService;

  protected readonly emitter = new Emitter<(tree: Tree) => Map<string, WidgetDecoration.Data>>();
  readonly onDidChangeDecorations: Event<(tree: Tree) => Map<string, WidgetDecoration.Data>> = this.emitter.event;

  constructor() {
    this.gitService.onDidChangeStatus(() => {
      this.emitter.fire(tree => this.computeDecorations(tree));
    });
  }

  decorations(tree: Tree): MaybePromise<Map<string, WidgetDecoration.Data>> {
    return this.computeDecorations(tree);
  }

  protected computeDecorations(tree: Tree): Map<string, WidgetDecoration.Data> {
    const result = new Map<string, WidgetDecoration.Data>();
    const repoRoot = this.gitService.getRepoRoot();
    if (!repoRoot) return result;

    const statusResult = this.gitService.getCachedStatus();
    if (!statusResult) return result;

    for (const node of this.collectNodes(tree.root)) {
      const filePath = this.getFilePath(node);
      if (!filePath) continue;

      let relative = filePath;
      if (filePath.startsWith('file://')) {
        relative = decodeURIComponent(filePath.replace('file://', ''));
        if (relative.startsWith(repoRoot)) {
          relative = relative.substring(repoRoot.length + 1);
        } else {
          continue;
        }
      } else if (filePath.startsWith(repoRoot)) {
        relative = filePath.substring(repoRoot.length + 1);
      } else if (!filePath.startsWith('/')) {
        // Already relative, keep as-is
      } else {
        continue;
      }

      const fileStatus = statusResult.files.find(
        (f: { path: string }) => f.path === relative,
      );
      if (!fileStatus) continue;

      const color = STATUS_COLORS[fileStatus.status] || STATUS_COLORS['?'];
      const label = STATUS_LABELS[fileStatus.status] || '';

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