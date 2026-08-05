import type { interfaces } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator';
import { bindViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { NavigatorTreeDecorator } from '@theia/navigator/lib/browser/navigator-decorator-service';

import { GitService } from './git-service';
import { GitStore } from './git-store';
import { GitChangesWidget } from './git-changes-widget';
import { GitDiffWidget } from './git-diff-widget';
import { GitCommitWidget } from './git-commit-widget';
import { GitFileStatusDecorator } from './git-file-status-decorator';
import { GitExplorerDecorator } from './git-explorer-decorator';
import { GitStatusBarContribution } from './git-status-bar-contribution';
import { GitHistoryWidget } from './git-history-widget';
import { GitHistoryContribution } from './git-history-contribution';
import { GitBlameDecorator } from './git-blame-decorator';
import { GitPreCommitChecker } from './git-precommit-check';
import { GitCommitTemplateService } from './git-commit-template';
import { GitCommitSearch } from './git-commit-search';
import { GitStashService } from './git-stash-service';
import { GitStashWidget } from './git-stash-widget';
import { GitStashContribution } from './git-stash-contribution';
import { GitCherryPickService } from './git-cherrypick-service';
import { GitCherryPickContribution } from './git-cherrypick-contribution';

export { GitService } from './git-service';
export type { GitFileStatus, GitStatusResult, GitCommit, GitBlameLine, GitDiffResult, GitCommitResult, GitCommitOptions } from './git-service';
export {
  uriToFsPath,
  toRepoRelativePath,
  decodeGitQuotedPath,
  parsePorcelainStatusZ,
  parsePorcelainStatusLines,
  normalizeFsPath,
} from './git-path-utils';
export { GitStore } from './git-store';
export type { GitChangesState } from './git-store';
export { GitChangesWidget } from './git-changes-widget';
export { GitDiffWidget } from './git-diff-widget';
export { GitCommitWidget } from './git-commit-widget';
export { GitFileStatusDecorator } from './git-file-status-decorator';
export { GitExplorerDecorator } from './git-explorer-decorator';
export { GitStatusBarContribution } from './git-status-bar-contribution';
export { GitHistoryWidget } from './git-history-widget';
export { GitHistoryContribution, GIT_HISTORY_TOGGLE_COMMAND } from './git-history-contribution';
export { GitBlameDecorator } from './git-blame-decorator';
export { GitPreCommitChecker } from './git-precommit-check';
export type { PreCommitCheckResult, PreCommitCheckConfig, PreCommitCheckStatus, PreCommitCheckSummary, PreCommitPreferences } from './git-precommit-check';
export { GitCommitTemplateService } from './git-commit-template';
export type { CommitType, CommitTemplate, CommitSuggestion } from './git-commit-template';
export { GitCommitSearch } from './git-commit-search';
export type { CommitSearchCriteria, CommitSearchResult, SearchHighlight, CommitSearchStatus, CommitSearchSummary } from './git-commit-search';
export { GitStashService } from './git-stash-service';
export type { GitStashEntry, GitStashShowResult } from './git-stash-service';
export { GitStashWidget } from './git-stash-widget';
export { GitStashContribution, GIT_STASH_TOGGLE_COMMAND } from './git-stash-contribution';
export { GitCherryPickService } from './git-cherrypick-service';
export type { CherryPickState, CherryPickStatus } from './git-cherrypick-service';
export { GitCherryPickContribution, GIT_CHERRY_PICK_COMMAND, GIT_CHERRY_PICK_CONTINUE_COMMAND, GIT_CHERRY_PICK_ABORT_COMMAND } from './git-cherrypick-contribution';

export function bindGitExtension(bind: interfaces.Bind): void {
  // Core services
  bind(GitService).toSelf().inSingletonScope();
  bind(GitStore).toSelf().inSingletonScope();
  bind(GitPreCommitChecker).toSelf().inSingletonScope();
  bind(GitCommitTemplateService).toSelf().inSingletonScope();
  bind(GitCommitSearch).toSelf().inSingletonScope();
  bind(GitStashService).toSelf().inSingletonScope();
  bind(GitCherryPickService).toSelf().inSingletonScope();

  // Changes, diff, commit widgets
  bind(GitChangesWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({
    id: GitChangesWidget.ID,
    createWidget: () => context.container.get(GitChangesWidget),
  })).inSingletonScope();
  bind(GitDiffWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({
    id: GitDiffWidget.ID,
    createWidget: () => context.container.get(GitDiffWidget),
  })).inSingletonScope();
  bind(GitCommitWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({
    id: GitCommitWidget.ID,
    createWidget: () => context.container.get(GitCommitWidget),
  })).inSingletonScope();

  // Tab bar decorator for file status
  bind(GitFileStatusDecorator).toSelf().inSingletonScope();
  bind(TabBarDecorator).toService(GitFileStatusDecorator);

  // Explorer tree decorator for file status
  bind(GitExplorerDecorator).toSelf().inSingletonScope();
  bind(NavigatorTreeDecorator).toService(GitExplorerDecorator);

  // Status bar contribution
  bind(GitStatusBarContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(GitStatusBarContribution);

  // History widget
  bind(GitHistoryWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({
    id: GitHistoryWidget.ID,
    createWidget: () => context.container.get(GitHistoryWidget),
  })).inSingletonScope();
  bindViewContribution(bind, GitHistoryContribution);

  // Blame decorator
  bind(GitBlameDecorator).toSelf().inSingletonScope();

  // Stash widget
  bind(GitStashWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({
    id: GitStashWidget.ID,
    createWidget: () => context.container.get(GitStashWidget),
  })).inSingletonScope();
  bindViewContribution(bind, GitStashContribution);

  // Cherry-pick contribution
  bind(GitCherryPickContribution).toSelf().inSingletonScope();
}