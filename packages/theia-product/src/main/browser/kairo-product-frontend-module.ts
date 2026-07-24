/**
 * Kairo product — frontend Theia module.
 *
 * This is the single InversifyJS module that the browser app
 * loads via the `theiaExtensions[].frontend` field. It binds:
 *
 *   * `KairoViewsContribution`     — commands, view containers, event wiring
 *   * `KairoStatusBarContribution` — status bar entries
 *   * Widget factories for the four Kairo views
 *
 * Widgets are not bound globally; they are constructed lazily
 * by the `WidgetManager` when the user opens a view.
 *
 * Service-layer bindings (BuildStore, KairoProjectService,
 * KairoServerService, etc.) are handled by `bindKairoProduct`
 * in product-bindings.ts and are NOT duplicated here.
 * The KairoProductFrontend ContainerModule in product-frontend.ts
 * calls both bindKairoFrontend (this module) and bindKairoProduct
 * so the container is fully populated.
 */

import { ContainerModule, interfaces } from '@theia/core/shared/inversify';
import {
  FrontendApplicationContribution,
  WidgetFactory,
} from '@theia/core/lib/browser';
// Activate Theia Git, SCM, and Terminal modules (auto-register on import).
// Git/SCM are optional — wrapped in try/catch for environments where
// @theia/git and @theia/scm are not installed (P1-GIT-01: needs real
// environment verification per checklist).
try {
  require('@theia/git/lib/browser/git-frontend-module');
} catch { /* @theia/git not available — Git features disabled */ }
try {
  require('@theia/scm/lib/browser/scm-frontend-module');
} catch { /* @theia/scm not available — SCM features disabled */ }
import '@theia/terminal/lib/browser/terminal-frontend-module';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { KeybindingContribution } from '@theia/core/lib/browser/keybinding';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import {
  KairoDeploymentsWidget,
  KairoViewsContribution,
} from './kairo-views-contribution';
import { KairoStatusBarContribution } from './kairo-status-bar-contribution';
import { KairoFileCommandsContribution } from './kairo-file-commands';
import { KairoEncodingCommandsContribution, KairoEncodingRegistry, KairoFileService, KairoSafeEncodingService, KairoEncodingTabDecorator } from '@kairo/encoding-extension';
import { EncodingService } from '@theia/core/lib/common/encoding-service';
import { EncodingRegistry } from '@theia/core/lib/browser/encoding-registry';
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { BuildViewWidget } from '@kairo/build-extension';
import { ServerViewWidget, LogViewerWidget } from '@kairo/tomcat-extension';
import {
  RuntimeConnectionService,
  KairoRuntime,
  KairoErrorListener,
  KairoErrorListenerImpl,
  WorkspaceContextService,
} from '@kairo/runtime-extension';
import { ImportWizardWidget, ProjectSelectorWidget } from '@kairo/project-extension';
import { KairoWelcomeWidget, KAIRO_WELCOME_FACTORY_ID } from './kairo-welcome-widget';
import { KairoWindowTitleContribution } from './kairo-window-title-contribution';
import { WindowTitleContribution } from '@theia/core/lib/browser/window/window-title-service';
import { KairoA11yPatchContribution } from './kairo-a11y-patch-contribution';
import { KairoSaveableService } from './kairo-saveable-service';
import { SaveableService } from '@theia/core/lib/browser/saveable-service';
import { KairoLargeFileContribution } from './kairo-large-file-contribution';
import { KairoLargeFilePreferenceContribution } from './kairo-large-file-preferences';
import { KairoEditorPreferenceContribution, KairoEditorAutoSaveSync } from './kairo-editor-preferences';
import { KairoSettingsPreferenceContribution } from './kairo-settings-preferences';
import { KairoSettingsService } from './kairo-settings-service';
import { KairoKeymapWidget, KAIRO_KEYMAP_FACTORY_ID } from './kairo-keymap-widget';
import { MavenViewWidget } from './maven-view-widget';
import { KairoTodoWidget, KAIRO_TODO_FACTORY_ID } from './kairo-todo-widget';
import { KairoEditorContribution } from './kairo-editor-contribution';
import { KairoDebugSessionManager, KairoJavaDebugService } from './kairo-java-debug-service';
import { KairoDebugSessionService } from './kairo-debug-session-service';
import { JavaHierarchyWidget } from '@kairo/java-extension';
import { KairoRunConfigurationService } from './kairo-run-configuration-service';
import { KairoRunConfigurationsWidget } from './kairo-run-configurations-widget';
import { KairoToolbarWidget } from './kairo-toolbar-widget';
import { DebugSessionManager } from '@theia/debug/lib/browser/debug-session-manager';
import { KairoProblemsWidget } from './kairo-problems-widget';
import { KairoSqlService } from './kairo-sql-service';
import { KairoSqlConsoleWidget } from './kairo-sql-console-widget';
import { KairoTestResultsWidget } from './kairo-test-results-widget';
import {
  KairoNotificationServiceImpl,
  KairoNotificationService,
  KairoNotificationCenterWidget,
  KairoNotificationCenterContribution,
  KAIRO_NOTIFICATION_CENTER_FACTORY_ID,
} from './kairo-notification-center';
import {
  LocalHistoryService,
  LocalHistoryWidget,
  LocalHistoryContribution,
} from './kairo-local-history';
import {
  KAIRO_SERVERS_FACTORY_ID,
  KAIRO_BUILDS_FACTORY_ID,
  KAIRO_DEPLOYMENTS_FACTORY_ID,
  KAIRO_LOGS_FACTORY_ID,
  KAIRO_IMPORT_WIZARD_FACTORY_ID,
  KAIRO_PROJECT_SELECTOR_FACTORY_ID,
  KAIRO_RUN_CONFIGURATIONS_FACTORY_ID,
  KAIRO_TOOLBAR_FACTORY_ID,
  KAIRO_PROBLEMS_FACTORY_ID,
  KAIRO_LOCAL_HISTORY_FACTORY_ID as _KAIRO_LOCAL_HISTORY_FACTORY_ID,
  KAIRO_TESTS_FACTORY_ID,
  KAIRO_MAVEN_FACTORY_ID,
  KAIRO_REMOTE_FACTORY_ID,
  KAIRO_PERF_FACTORY_ID,
  KAIRO_SQL_CONSOLE_FACTORY_ID,
  KAIRO_DEBUG_VARIABLES_FACTORY_ID,
  KAIRO_DEBUG_CALLSTACK_FACTORY_ID,
  KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID,
  KAIRO_DEBUG_TOOLBAR_FACTORY_ID,
  KAIRO_DEBUG_CONSOLE_FACTORY_ID,
  KAIRO_DEBUG_WATCH_FACTORY_ID,
  KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID,
  KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID,
  KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID,
} from './kairo-factory-ids';
import { KairoRemoteAgentService } from './kairo-remote-agent-service';
import { KairoRemoteFileSystemProvider } from './kairo-remote-fs-provider';
import { KairoRemoteWidget } from './kairo-remote-widget';
import { KairoColdStartTimer, KairoCompletionTimer } from './kairo-cold-start-timer';
import { KairoSearchTimer } from './kairo-search-timer';
import { KairoMemoryTracker } from './kairo-memory-tracker';
import { KairoPerfDashboardWidget } from './kairo-perf-dashboard-widget';
import { KairoNavigationContribution } from './kairo-navigation-contribution';
import { KairoScreenReaderService } from './kairo-screen-reader';
import { KairoFocusManagement } from './kairo-focus-management';
import { KairoShortcutsWidget, KAIRO_SHORTCUTS_FACTORY_ID } from './kairo-shortcuts-widget';
import { KairoDebugVariablesWidget } from './debug-variables-widget';
import { KairoDebugCallStackWidget } from './debug-callstack-widget';
import { KairoDebugBreakpointsWidget } from './debug-breakpoints-widget';
import { KairoDebugToolbarWidget } from './debug-toolbar-widget';
import { KairoDebugConsoleWidget } from './debug-console-widget';
import { KairoDebugWatchWidget } from './debug-watch-widget';
import { KairoDebugConfigService } from './debug-config-service';
import { KairoDebugModuleSelectorWidget } from './debug-module-selector-widget';
import { KairoDebugConditionEditorWidget } from './debug-condition-editor-widget';
import { KairoDebugHotSwapStatusWidget } from './debug-hotswap-status-widget';

// Re-export so existing consumers can keep importing the IDs from
// this module; the definitions live in kairo-factory-ids.ts.
export {
  KAIRO_SERVERS_FACTORY_ID,
  KAIRO_BUILDS_FACTORY_ID,
  KAIRO_DEPLOYMENTS_FACTORY_ID,
  KAIRO_LOGS_FACTORY_ID,
  KAIRO_IMPORT_WIZARD_FACTORY_ID,
  KAIRO_PROJECT_SELECTOR_FACTORY_ID,
  KAIRO_RUN_CONFIGURATIONS_FACTORY_ID,
  KAIRO_TOOLBAR_FACTORY_ID,
  KAIRO_PROBLEMS_FACTORY_ID,
  KAIRO_KEYMAP_FACTORY_ID,
  KAIRO_TODO_FACTORY_ID,
  KAIRO_TESTS_FACTORY_ID,
  KAIRO_PERF_FACTORY_ID,
  KAIRO_DEBUG_VARIABLES_FACTORY_ID,
  KAIRO_DEBUG_CALLSTACK_FACTORY_ID,
  KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID,
  KAIRO_DEBUG_TOOLBAR_FACTORY_ID,
  KAIRO_DEBUG_CONSOLE_FACTORY_ID,
  KAIRO_DEBUG_WATCH_FACTORY_ID,
  KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID,
  KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID,
  KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID,
} from './kairo-factory-ids';

export function bindKairoFrontend(bind: interfaces.Bind, unbind?: interfaces.Unbind, isBound?: interfaces.IsBound, rebind?: interfaces.Rebind): void {
  // ── Kairo runtime client + workspace context ────────────────
  // Mirrors KairoRuntimeModule in
  // packages/runtime-extension/src/browser/index.ts. We have
  // to inline the bindings here because Theia loads this
  // module via `theiaExtensions[].frontend` and does not
  // give us a `container.load(...)` hook to compose the
  // existing KairoRuntimeModule ContainerModule.
  // Bindings: RuntimeConnectionService, KairoRuntime,
  // KairoErrorListener, WorkspaceContextService. Every
  // per-extension service below injects at least one of
  // these, so they must be in the frontend container
  // (N-023 / N-026 in MILESTONES.md).
  if (isBound && rebind && isBound(RuntimeConnectionService)) {
    rebind(RuntimeConnectionService).toSelf().inSingletonScope();
  } else {
    bind(RuntimeConnectionService).toSelf().inSingletonScope();
  }
  if (isBound && rebind && isBound(KairoRuntime)) {
    rebind(KairoRuntime).toService(RuntimeConnectionService);
  } else {
    bind(KairoRuntime).toService(RuntimeConnectionService);
  }
  if (isBound && rebind && isBound(KairoErrorListener)) {
    rebind(KairoErrorListener).to(KairoErrorListenerImpl).inSingletonScope();
  } else {
    bind(KairoErrorListener).to(KairoErrorListenerImpl).inSingletonScope();
  }
  if (isBound && rebind && isBound(WorkspaceContextService)) {
    rebind(WorkspaceContextService).toSelf().inSingletonScope();
  } else {
    bind(WorkspaceContextService).toSelf().inSingletonScope();
  }
  // N-026: ensure WorkspaceContextService is created early so it
  // can re-sync when the runtime (re)connects.
  bind(FrontendApplicationContribution).toService(WorkspaceContextService);

  // ── Kairo contributions ──────────────────────────────────────
  bind(KairoStatusBarContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoStatusBarContribution);
  bind(KairoViewsContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoViewsContribution);
  // The Kairo views contribution also registers commands
  // (Build / Build & Deploy / Start / Stop / etc.). Bind
  // it as a CommandContribution so Theia's command registry
  // picks up the methods.
  bind(CommandContribution).toService(KairoViewsContribution);
  bind(KeybindingContribution).toService(KairoViewsContribution);
  bind(MenuContribution).toService(KairoViewsContribution);
  bind(KairoJavaDebugService).toSelf().inSingletonScope();
  bind(KairoDebugSessionManager).toService(DebugSessionManager);
  bind(KairoRunConfigurationService).toSelf().inSingletonScope();
  bind(KairoSqlService).toSelf().inSingletonScope();
  bind(CommandContribution).toService(KairoEncodingCommandsContribution);

  // KAIRO-RC-WEB-229: replace Theia's lossy encoder (iconv silently
  // rewrites unrepresentable chars to '?') with the validating one.
  if (isBound && rebind && isBound(EncodingService)) {
    rebind(EncodingService).to(KairoSafeEncodingService).inSingletonScope();
  } else {
    bind(EncodingService).to(KairoSafeEncodingService).inSingletonScope();
  }

  // KAIRO-RC-WEB-206: stock Theia's EncodingRegistry tests folder
  // overrides with the comparison backwards (resource.isEqualOrParent(parent)),
  // so a file inside the folder never matches — project-level GBK was
  // dead. Replace it with the hierarchy-correct registry.
  if (isBound && rebind && isBound(EncodingRegistry)) {
    rebind(EncodingRegistry).to(KairoEncodingRegistry).inSingletonScope();
  } else {
    bind(EncodingRegistry).to(KairoEncodingRegistry).inSingletonScope();
  }

  // KairoFileCommandsContribution is a defensive re-registration
  // of the standard Theia file.* / workspace:* / core.* commands.
  // Theia's standard modules already register these, but a
  // missing module in a stripped build causes the menu bar to
  // throw "No command X exists" at click time. This contribution
  // guarantees the commands are always present (either the real
  // handler or a friendly fallback message). See
  // kairo-file-commands.ts for the long version of this rationale.
  bind(KairoFileCommandsContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(KairoFileCommandsContribution);

  // KairoLargeFileContribution: adaptive large-file performance
  // mode (see kairo-large-file-contribution.ts).
  bind(KairoLargeFileContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoLargeFileContribution);
  bind(CommandContribution).toService(KairoLargeFileContribution);
  bind(PreferenceContribution).toConstantValue(KairoLargeFilePreferenceContribution);

  // KairoEditorPreferenceContribution: registers editor.autoSave and
  // editor.autoSaveDelay preferences (B3.1 auto-save strategy).
  bind(PreferenceContribution).toConstantValue(KairoEditorPreferenceContribution);
  bind(KairoEditorAutoSaveSync).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoEditorAutoSaveSync);

  // KairoSettingsPreferenceContribution: registers Kairo-specific
  // preference categories (general, appearance, build, server, etc.)
  // for the Theia Preferences widget (G1: P2-UX-01).
  bind(PreferenceContribution).toConstantValue(KairoSettingsPreferenceContribution);

  // KairoSettingsService: project-level settings persistence
  // to .kairo/settings.json (G1: P2-UX-01).
  bind(KairoSettingsService).toSelf().inSingletonScope();

  // KairoEditorContribution: external modification conflict handling,
  // breadcrumbs enablement, and read-only file handling (B3.2–B3.4).
  bind(KairoEditorContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoEditorContribution);
  bind(CommandContribution).toService(KairoEditorContribution);
  bind(KeybindingContribution).toService(KairoEditorContribution);
  bind(MenuContribution).toService(KairoEditorContribution);

  // P2-UX-03: Notification Center — aggregated notifications,
  // bell icon in status bar with unread count badge, expandable
  // history, last 50 items, clearable.
  bind(KairoNotificationServiceImpl).toSelf().inSingletonScope();
  bind(KairoNotificationService).toService(KairoNotificationServiceImpl);
  bind(KairoNotificationCenterContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoNotificationCenterContribution);
  bind(CommandContribution).toService(KairoNotificationCenterContribution);
  bind(KairoNotificationCenterWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_NOTIFICATION_CENTER_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoNotificationCenterWidget),
  })).inSingletonScope();

  // P2-GIT-03: Local History — snapshot timeline, diff, and restore
  bind(LocalHistoryService).toSelf().inSingletonScope();
  bind(LocalHistoryWidget).toSelf();
  bind(LocalHistoryContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(LocalHistoryContribution);
  bind(CommandContribution).toService(LocalHistoryContribution);

  bind(KairoDeploymentsWidget).toSelf();
  bind(KairoRunConfigurationsWidget).toSelf();
  bind(KairoToolbarWidget).toSelf();
  bind(KairoProblemsWidget).toSelf();
  bind(KairoSqlConsoleWidget).toSelf();
  bind(KairoTestResultsWidget).toSelf();
  bind(MavenViewWidget).toSelf();
  bind(KairoTodoWidget).toSelf();

  // Register widget factories so the WidgetManager can lazily
  // construct each view the first time the user opens it.
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_SERVERS_FACTORY_ID,
    createWidget: () => ctx.container.get(ServerViewWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_BUILDS_FACTORY_ID,
    createWidget: () => ctx.container.get(BuildViewWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEPLOYMENTS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDeploymentsWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_LOGS_FACTORY_ID,
    createWidget: () => ctx.container.get(LogViewerWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_RUN_CONFIGURATIONS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoRunConfigurationsWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_TOOLBAR_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoToolbarWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_PROBLEMS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoProblemsWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_KEYMAP_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoKeymapWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_MAVEN_FACTORY_ID,
    createWidget: () => ctx.container.get(MavenViewWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_TODO_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoTodoWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_TESTS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoTestResultsWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_SQL_CONSOLE_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoSqlConsoleWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: 'kairo-java-hierarchy',
    createWidget: () => ctx.container.get(JavaHierarchyWidget),
  })).inSingletonScope();

  // Import Wizard and Project Selector are the primary entry
  // points for the Kairo project workflow. They must be reachable
  // from the composition root (command palette / File menu).
  bind(ImportWizardWidget).toSelf();
  bind(ProjectSelectorWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_IMPORT_WIZARD_FACTORY_ID,
    createWidget: () => ctx.container.get(ImportWizardWidget),
  })).inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_PROJECT_SELECTOR_FACTORY_ID,
    createWidget: () => ctx.container.get(ProjectSelectorWidget),
  })).inSingletonScope();

  // Welcome tab — the first-run entry point (KAIRO-RC-WEB-018).
  bind(KairoWelcomeWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_WELCOME_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoWelcomeWidget),
  })).inSingletonScope();

  // Branded window title: "<widget> - <workspace> - Kairo IDE".
  bind(WindowTitleContribution).to(KairoWindowTitleContribution).inSingletonScope();

  // Runtime ARIA patch for stock Theia/Lumino chrome (WEB-019).
  bind(KairoA11yPatchContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoA11yPatchContribution);

  // MonacoEditorModel.run() swallows save errors with a bare
  // console.error — encoding refusals would never reach the user.
  // KairoFileService reports them as error notifications.
  if (isBound && rebind && isBound(FileService)) {
    rebind(FileService).to(KairoFileService).inSingletonScope();
  } else {
    bind(FileService).to(KairoFileService).inSingletonScope();
  }

  // Surface save failures (notably encoding refusals) as error
  // notifications — stock Theia only logs them to the console.
  if (isBound && rebind && isBound(SaveableService)) {
    rebind(SaveableService).to(KairoSaveableService).inSingletonScope();
  } else {
    bind(SaveableService).to(KairoSaveableService).inSingletonScope();
  }

  // Encoding tab decorator — shows encoding suffix on editor tabs.
  bind(KairoEncodingTabDecorator).toSelf().inSingletonScope();
  bind(TabBarDecorator).toService(KairoEncodingTabDecorator);

  // ── Performance instrumentation ─────────────────────────────
  bind(KairoColdStartTimer).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoColdStartTimer);
  bind(KairoCompletionTimer).toSelf().inSingletonScope();
  bind(KairoSearchTimer).toSelf().inSingletonScope();
  bind(KairoMemoryTracker).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoMemoryTracker);
  bind(KairoPerfDashboardWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_PERF_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoPerfDashboardWidget),
  })).inSingletonScope();

  // ── Kairo Remote Development ────────────────────────────────
  bind(KairoRemoteAgentService).toSelf().inSingletonScope();
  bind(KairoRemoteFileSystemProvider).toSelf().inSingletonScope();
  bind(KairoRemoteWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_REMOTE_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoRemoteWidget),
  })).inSingletonScope();

  // ── Kairo Navigation Enhancement ──────────────────────────────
  bind(KairoNavigationContribution).toSelf().inSingletonScope();
  bind(CommandContribution).toService(KairoNavigationContribution);
  bind(KeybindingContribution).toService(KairoNavigationContribution);

  // ── Kairo Accessibility ───────────────────────────────────────
  bind(KairoScreenReaderService).toSelf().inSingletonScope();
  bind(KairoFocusManagement).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(KairoFocusManagement);
  bind(CommandContribution).toService(KairoFocusManagement);
  bind(KeybindingContribution).toService(KairoFocusManagement);

  // ── Kairo Keyboard Shortcuts Widget ──────────────────────────
  bind(KairoShortcutsWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_SHORTCUTS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoShortcutsWidget),
  })).inSingletonScope();

  // ── Kairo Debug Widgets ──────────────────────────────────────
  bind(KairoDebugSessionService).toSelf().inSingletonScope();
  bind(KairoDebugConfigService).toSelf().inSingletonScope();
  bind(KairoDebugVariablesWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_VARIABLES_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDebugVariablesWidget),
  })).inSingletonScope();
  bind(KairoDebugCallStackWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_CALLSTACK_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDebugCallStackWidget),
  })).inSingletonScope();
  bind(KairoDebugBreakpointsWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDebugBreakpointsWidget),
  })).inSingletonScope();
  bind(KairoDebugToolbarWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_TOOLBAR_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDebugToolbarWidget),
  })).inSingletonScope();
  bind(KairoDebugConsoleWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_CONSOLE_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDebugConsoleWidget),
  })).inSingletonScope();
  bind(KairoDebugWatchWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_WATCH_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDebugWatchWidget),
  })).inSingletonScope();
  bind(KairoDebugModuleSelectorWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDebugModuleSelectorWidget),
  })).inSingletonScope();
  bind(KairoDebugConditionEditorWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDebugConditionEditorWidget),
  })).inSingletonScope();
  bind(KairoDebugHotSwapStatusWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDebugHotSwapStatusWidget),
  })).inSingletonScope();
}

export default new ContainerModule((bind, unbind, isBound, rebind) => {
  bindKairoFrontend(bind, unbind, isBound, rebind);
});
