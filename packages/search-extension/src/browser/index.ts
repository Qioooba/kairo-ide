import type { interfaces } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { bindViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { KairoSearchService } from './search-service';
import { KairoSearchSessionModel } from './search-session-model';
import { SearchStreamService } from './search-stream-service';
import { SearchCenterWidget } from './search-center-widget';
import { SearchCenterContribution } from './search-center-contribution';
import { SearchEverywhereWidget } from './search-everywhere-widget';
import { SearchEverywhereContribution } from './search-everywhere-contribution';
import { SearchEverywhereModel, SearchEverywhereProvider } from './search-everywhere-model';
import { SearchEverywhereActionsProvider, SearchEverywhereFilesProvider, SearchEverywhereJavaProvider } from './search-everywhere-providers';
import { SearchReplaceService } from './search-replace-service';
import { FindFileModel } from './find-file-model';
import { FindFileWidget } from './find-file-widget';
import { FindFileContribution } from './find-file-contribution';
import { FindClassModel } from './find-class-model';
import { FindClassWidget } from './find-class-widget';
import { FindClassContribution } from './find-class-contribution';
import { FindSymbolModel, FindSymbolWidget } from './find-symbol-widget';
import { FindSymbolContribution } from './find-symbol-contribution';
import { FindActionModel } from './find-action-model';
import { FindActionWidget } from './find-action-widget';
import { FindActionContribution } from './find-action-contribution';
import { SearchScopeModel } from './search-scope-model';
import { FileIndexService } from './file-index-service';
import { SearchResultsWidget } from './search-results-widget';
import { SearchResultsContribution } from './search-results-contribution';

export { KairoSearchCancelledError, KairoSearchService } from './search-service';
export type { SearchOptions } from './search-service';
export { KairoSearchSessionModel } from './search-session-model';
export { SearchStreamService } from './search-stream-service';
export type {
  SearchSessionListener,
  SearchSessionState,
  SearchSessionStatus,
} from './search-session-model';
export type {
  SearchStreamStatus,
  SearchStreamState,
  SearchStreamListener,
} from './search-stream-service';
export { SearchCenterWidget, SearchCenterComponent, groupMatchesByFile, parseGlobInput } from './search-center-widget';
export { resolveWorkspaceMatchUri } from './search-path';
export type { SearchCenterProps, SearchCenterQuery, SearchResultGroup } from './search-center-widget';
export { SearchCenterContribution } from './search-center-contribution';
export { SearchEverywhereWidget, SearchEverywhereComponent } from './search-everywhere-widget';
export { SearchEverywhereContribution, DoubleShiftDetector } from './search-everywhere-contribution';
export { SearchEverywhereModel, SearchEverywhereProvider, fuzzyScore } from './search-everywhere-model';
export { SearchEverywhereActionsProvider, SearchEverywhereFilesProvider, SearchEverywhereJavaProvider } from './search-everywhere-providers';
export type { SearchEverywhereCategory, SearchEverywhereItem, SearchEverywhereItemCategory, SearchEverywhereListener, SearchEverywhereState } from './search-everywhere-model';
export { SearchReplaceService, locateEdits, applyEdits, fingerprint, SEARCH_REPLACE_MAX_FILE_BYTES } from './search-replace-service';
export type { ReplaceEdit, ReplaceFilePlan, ReplacePlan, ReplaceApplyResult } from './search-replace-service';
export { FindFileModel } from './find-file-model';
export { FindFileWidget, FindFileComponent } from './find-file-widget';
export { FindFileContribution } from './find-file-contribution';
export type { FindFileItem, FindFileState, FindFileListener } from './find-file-model';
export { FindClassModel } from './find-class-model';
export { FindClassWidget, FindClassComponent } from './find-class-widget';
export { FindClassContribution } from './find-class-contribution';
export type { FindClassItem, FindClassState, FindClassListener } from './find-class-model';
export { FindSymbolModel, FindSymbolWidget, FindSymbolComponent } from './find-symbol-widget';
export { FindSymbolContribution } from './find-symbol-contribution';
export { FindActionModel } from './find-action-model';
export { FindActionWidget, FindActionComponent } from './find-action-widget';
export { FindActionContribution } from './find-action-contribution';
export type { FindActionItem, FindActionState, FindActionListener } from './find-action-model';
export { SearchScopeModel, SCOPE_OPTIONS, GROUP_MODE_OPTIONS } from './search-scope-model';
export type { SearchScope, GroupMode, SearchFilter, SearchHistoryEntry, SearchScopeOption, GroupModeOption } from './search-scope-model';
export { FileIndexService } from './file-index-service';
export { parseFileMask, mergeGlobs, normalizeMaskToken } from './file-mask';
export type { ParsedFileMask } from './file-mask';
export { SearchResultsWidget, SearchResultsPanel } from './search-results-widget';
export { SearchResultsContribution } from './search-results-contribution';
export { sameLineContext, multiLineContext } from './search-result-utils';

export function bindSearchExtension(bind: interfaces.Bind): void {
  bind(KairoSearchService).toSelf().inSingletonScope();
  bind(KairoSearchSessionModel).toSelf().inSingletonScope();
  bind(SearchStreamService).toSelf().inSingletonScope();
  bind(SearchScopeModel).toSelf().inSingletonScope();
  bind(FileIndexService).toSelf().inSingletonScope();
  bind(SearchCenterWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SearchCenterWidget.ID,
    createWidget: () => context.container.get(SearchCenterWidget),
  })).inSingletonScope();
  bindViewContribution(bind, SearchCenterContribution);
  // bindViewContribution does NOT register the contribution as a
  // FrontendApplicationContribution, so SearchCenterContribution.onStart()
  // (which installs the Ctrl+Shift+F window keydown handler) was never
  // invoked and the shortcut fell through to Theia's built-in search.
  // Bind it explicitly so the Search Center opens from the shortcut.
  bind(FrontendApplicationContribution).toService(SearchCenterContribution);
  bind(SearchResultsWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SearchResultsWidget.ID,
    createWidget: () => context.container.get(SearchResultsWidget),
  })).inSingletonScope();
  bindViewContribution(bind, SearchResultsContribution);
  bind(SearchEverywhereModel).toSelf().inSingletonScope();
  bind(SearchEverywhereFilesProvider).toSelf().inSingletonScope();
  bind(SearchEverywhereJavaProvider).toSelf().inSingletonScope();
  bind(SearchEverywhereActionsProvider).toSelf().inSingletonScope();
  bind(SearchEverywhereProvider).toService(SearchEverywhereFilesProvider);
  bind(SearchEverywhereProvider).toService(SearchEverywhereJavaProvider);
  bind(SearchEverywhereProvider).toService(SearchEverywhereActionsProvider);
  bind(SearchEverywhereWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({ id: SearchEverywhereWidget.ID, createWidget: () => context.container.get(SearchEverywhereWidget) })).inSingletonScope();
  bindViewContribution(bind, SearchEverywhereContribution);
  bind(FrontendApplicationContribution).toService(SearchEverywhereContribution);
  bind(SearchReplaceService).toSelf().inSingletonScope();
  // Find File
  bind(FindFileModel).toSelf().inSingletonScope();
  bind(FindFileWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({ id: FindFileWidget.ID, createWidget: () => context.container.get(FindFileWidget) })).inSingletonScope();
  bindViewContribution(bind, FindFileContribution);
  // Find Class
  bind(FindClassModel).toSelf().inSingletonScope();
  bind(FindClassWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({ id: FindClassWidget.ID, createWidget: () => context.container.get(FindClassWidget) })).inSingletonScope();
  bindViewContribution(bind, FindClassContribution);
  // Find Symbol
  bind(FindSymbolModel).toSelf().inSingletonScope();
  bind(FindSymbolWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({ id: FindSymbolWidget.ID, createWidget: () => context.container.get(FindSymbolWidget) })).inSingletonScope();
  bindViewContribution(bind, FindSymbolContribution);
  // Find Action
  bind(FindActionModel).toSelf().inSingletonScope();
  bind(FindActionWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(context => ({ id: FindActionWidget.ID, createWidget: () => context.container.get(FindActionWidget) })).inSingletonScope();
  bindViewContribution(bind, FindActionContribution);
}