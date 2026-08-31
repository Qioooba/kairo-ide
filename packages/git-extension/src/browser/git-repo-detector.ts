import { injectable, inject } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
} from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { DisposableCollection } from '@theia/core';
import { GitService } from './git-service';

/**
 * Watches the workspace and adopts the first enclosing git repository so
 * GitService works without any explicit wiring. Kept out of GitService
 * itself to leave the service free of browser dependencies.
 */
@injectable()
export class GitRepoDetector implements FrontendApplicationContribution {
  @inject(GitService) protected readonly gitService!: GitService;
  @inject(WorkspaceService) protected readonly workspaceService!: WorkspaceService;

  protected readonly toDispose = new DisposableCollection();

  onStart(): void {
    void this.detect();
    this.toDispose.push(this.workspaceService.onWorkspaceChanged(() => {
      void this.detect();
    }));
    this.toDispose.push(this.workspaceService.onWorkspaceLocationChanged(() => {
      void this.detect();
    }));
  }

  onStop(): void {
    this.toDispose.dispose();
  }

  protected async detect(): Promise<void> {
    const roots = this.workspaceService.tryGetRoots();
    for (const root of roots) {
      if (!root.resource) continue;
      const fsPath = root.resource.path.toString();
      const found = await this.gitService.findNearestRepoRoot(fsPath, 2);
      if (found) {
        if (found !== this.gitService.getRepoRoot()) {
          this.gitService.setRepoRoot(found);
        }
        return;
      }
    }
    // A repository can be deleted or moved while the IDE remains open. Do
    // not leave the previous root/status visible forever in that case.
    if (this.gitService.getRepoRoot()) {
      this.gitService.setRepoRoot(undefined);
    }
  }
}
