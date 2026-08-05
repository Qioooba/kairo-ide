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
import { Container } from '@theia/core/shared/inversify';

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
import { ServerViewWidget, LogViewerWidget, HotDeployService } from '@kairo/tomcat-extension';
import { bindSvnExtension } from '@kairo/svn-extension';
import { bindKairoI18n } from '@kairo/i18n';
import {
  RuntimeConnectionService,
  KairoRuntime,
  KairoErrorListener,
  KairoErrorListenerImpl,
  WorkspaceContextService,
} from '@kairo/runtime-extension';
import { ImportWizardWidget, ProjectSelectorWidget, ProjectStructureContribution } from '@kairo/project-extension';
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
  KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID,
  KAIRO_DEBUG_DIAGNOSTICS_FACTORY_ID,
  KAIRO_BOOKMARKS_FACTORY_ID,
  KAIRO_SHORTCUT_CHEATSHEET_FACTORY_ID as _KAIRO_SHORTCUT_CHEATSHEET_FACTORY_ID,
} from './kairo-factory-ids';
import { KairoRemoteAgentService } from './kairo-remote-agent-service';
import { KairoRemoteFileSystemProvider } from './kairo-remote-fs-provider';
import { KairoRemoteWidget } from './kairo-remote-widget';
import { KairoColdStartTimer, KairoCompletionTimer } from './kairo-cold-start-timer';
import { KairoSearchTimer } from './kairo-search-timer';
import { KairoMemoryTracker } from './kairo-memory-tracker';
import { KairoPerfDashboardWidget } from './kairo-perf-dashboard-widget';
import { KairoPerfSampler } from './kairo-perf-sampler';
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
import { KairoDebugConditionEditorWidget } from './debug-condition-editor-widget';
import { DebugDiagnosticsWidget } from './debug-diagnostics-widget';
import { KairoDebugToolWindowWidget } from './debug-tool-window-widget';
import { KairoDebugHoverProvider } from './debug-hover-provider';
import { KairoDebugInlineValuesService } from './debug-inline-values';
import {
  KAIRO_DEBUG_TOOL_WINDOW_FACTORY_ID,
} from './kairo-factory-ids';
import { BookmarkService } from './kairo-bookmark-service';
import { KairoBookmarksWidget } from './kairo-bookmark-widget';
import { KairoBookmarkContribution } from './kairo-bookmark-contribution';
import { KairoShortcutCheatsheetContribution } from './kairo-shortcut-cheatsheet';
import { KairoIDEAWindowsKeymapContribution } from './kairo-idea-windows-keymap';
import { KairoIDEAMacKeymapContribution } from './kairo-idea-mac-keymap';
import { KairoIDEAMonacoKeymapContribution } from './kairo-idea-monaco-keymap';
import { KairoIDEAMacMonacoKeymapContribution } from './kairo-idea-mac-monaco-keymap';
import { KairoBrowserKeyboardGuardContribution } from './kairo-browser-keyboard-guard';
import { KairoShellLayoutContribution } from './kairo-shell-layout-contribution';
// Import plugin-ext frontend module to initialize the VS Code Extension Host
import '@theia/plugin-ext/lib/main/browser/plugin-ext-frontend-module';

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
  KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID,
  KAIRO_DEBUG_DIAGNOSTICS_FACTORY_ID,
  KAIRO_BOOKMARKS_FACTORY_ID,
  KAIRO_SHORTCUT_CHEATSHEET_FACTORY_ID,
} from './kairo-factory-ids';

export function bindKairoFrontend(bind: interfaces.Bind, unbind?: interfaces.Unbind, isBound?: interfaces.IsBound, rebind?: interfaces.Rebind): void {
  // ── DI safety net ────────────────────────────────────────────
  // KAIRO-RC-WEB-2026-07-25-01: Theia 1.73.1 + InversifyJS 6.2.2
  // performs `getAll(FrontendApplicationContribution)` synchronously
  // during ApplicationShell.startContributions. Inversify's `toService`
  // helper falls back from `container.get(X)` to `container.getAsync(X)`
  // when the service is missing, returning a Promise instead of an
  // instance. Once any binding in the multi-binding returns a Promise,
  // the *whole* `getAll` returns a Promise, Theia calls
  // `for (const c of this.contributions.getContributions())`, iterates
  // the Promise as a one-element array, and the menu bar / status bar
  // / editor manager / command registry never finish wiring.
  //
  // The fix: replace `toService` with a `toDynamicValue` that catches
  // construction errors and returns a no-op contribution. This keeps
  // `getAll` synchronous even when a transitive dependency is broken
  // (missing binding, async @postConstruct, async @inject, etc.) and
  // logs the specific failure to the console for follow-up.
  //
  // The failure is memoized so that subsequent multi-bindings of the
  // same service (CommandContribution, MenuContribution,
  // KeybindingContribution) all observe the same no-op rather than
  // each attempting to re-construct and re-fail.
  const noopFailureCache = new Map<interfaces.ServiceIdentifier<unknown> | interfaces.Newable<unknown>, unknown>();
  // A no-op class that implements every method Theia may invoke on a
  // contribution. The class-based shape (rather than a plain object or
  // a Proxy) is required because:
  //   * InversifyJS internally does `instanceof` checks when wiring
  //     services.
  //   * Theia iterates `getAll(...)` results and calls
  //     `initialize`, `onStart`, `onStop`, `registerCommands`,
  //     `registerMenus`, `registerKeybindings` — a plain object that
  //     only has `onStart` throws `registerCommands is not a function`.
  //   * A Proxy that returns a function for any property access still
  //     trips Theia's class-instance check (e.g. `obj instanceof X`)
  //     and results in `Cannot read properties of undefined (reading
  //     'initialize')` at `startContributions`.
  //
  // The class below exposes the union of all known Theia contribution
  // methods as no-ops, so the app can start even when a Kairo
  // contribution fails to construct.
  class KairoNoopContribution {
    public initialize(_app: any): void { /* no-op */ }
    public onStart(_app: any): void { /* no-op */ }
    public onStop(_app: any): void { /* no-op */ }
    public registerCommands(..._args: any[]): void { /* no-op */ }
    public registerMenus(..._args: any[]): void { /* no-op */ }
    public registerKeybindings(..._args: any[]): void { /* no-op */ }
    public registerToolbarItems(..._args: any[]): void { /* no-op */ }
    public registerOpenHandlers?(..._args: any[]): void { /* no-op */ }
    public configure?(_app: any): void { /* no-op */ }
    public onWillStop?(): boolean | undefined { return undefined; }
    public canHandle?(..._args: any[]): number { return 0; }
    public open?(..._args: any[]): any { return undefined; }
    public getWidgets?(): any[] { return []; }
  }
  const safeContribution = <T extends object>(
    id: interfaces.ServiceIdentifier<T>,
    service: interfaces.Newable<T> | interfaces.ServiceIdentifier<T>,
    name: string,
  ): void => {
    const cacheKey = service as interfaces.ServiceIdentifier<unknown> | interfaces.Newable<unknown>;
    bind(id).toDynamicValue(ctx => {
      // Reuse a previously-constructed instance or a no-op fallback so
      // that every multi-binding (FrontendApplicationContribution /
      // CommandContribution / MenuContribution / KeybindingContribution)
      // for the same Kairo class sees the same value.
      const cached = noopFailureCache.get(cacheKey);
      if (cached !== undefined) {
        return cached as T;
      }
      try {
        // NOTE: `toDynamicValue` MUST be synchronous. If a service has
        // an async @postConstruct, `container.get` returns a Promise,
        // Theia iterates the array of FrontendApplicationContributions
        // synchronously, and a Promise entry is treated as a
        // contribution object → `Promise.initialize` is undefined →
        // "Cannot read properties of undefined (reading 'initialize')"
        // at startContributions. So we catch both thrown errors and
        // Promise returns, and fall back to a no-op.
        const resolved = typeof service === 'function' && service.prototype
          ? ctx.container.get<T>(service as interfaces.Newable<T>)
          : ctx.container.get<T>(service as interfaces.ServiceIdentifier<T>);
        if (resolved && typeof (resolved as { then?: unknown }).then === 'function') {
          console.error(`[kairo] ${name} resolved as Promise; installing synchronous no-op to keep getAll() synchronous.`);
          const noop = new KairoNoopContribution() as unknown as T;
          noopFailureCache.set(cacheKey, noop);
          return noop;
        }
        return resolved;
      } catch (e) {
        console.error(`[kairo] ${name} failed to construct; installing no-op:`, e);
        const noop = new KairoNoopContribution() as unknown as T;
        noopFailureCache.set(cacheKey, noop);
        return noop;
      }
    });
  };

  // ── DI fallback bindings for Theia core services ────────────
  // KAIRO-RC-DESKTOP-2026-07-29: Theia modules (@theia/filesystem,
  // @theia/debug, etc.) may be loaded after Kairo modules during
  // frontend startup. When a Kairo contribution tries to inject a
  // Theia service that hasn't been bound yet, Inversify throws
  // "No matching bindings found" and the contribution is replaced
  // with a no-op. The workbench shell renders but all Kairo views,
  // commands, menus, and status bar entries are missing.
  //
  // We add fallback bindings for services that the Kairo
  // contributions depend on transitively. The real Theia modules
  // will rebind these later; the fallbacks are only used during
  // the initial module-loading window.
  if (isBound) {
    try {
      // FileSystemPreferences — used by encoding, editor, local history
      const { FileSystemPreferences } = require('@theia/filesystem/lib/common/filesystem-preferences');
      if (!isBound(FileSystemPreferences)) {
        bind(FileSystemPreferences).toConstantValue({
          'files.encoding': 'utf8',
          'files.autoGuessEncoding': false,
          'files.eol': 'auto',
          'files.autoSave': 'off',
          'files.autoSaveDelay': 1000,
        } as any);
      }
    } catch { /* @theia/filesystem not available */ }

    try {
      // FileDialogService — used by project structure, telemetry
      const { FileDialogService } = require('@theia/filesystem/lib/browser');
      if (!isBound(FileDialogService)) {
        bind(FileDialogService).toConstantValue({
          showOpenDialog: () => Promise.resolve(undefined),
          showSaveDialog: () => Promise.resolve(undefined),
        } as any);
      }
    } catch { /* @theia/filesystem not available */ }

    try {
      // DebugSessionManager — used by KairoJavaDebugService
      const { DebugSessionManager } = require('@theia/debug/lib/browser/debug-session-manager');
      if (!isBound(DebugSessionManager)) {
        bind(DebugSessionManager).toConstantValue({
          onDidChange: () => ({ dispose: () => {} }),
          onDidCreateDebugSession: () => ({ dispose: () => {} }),
          onDidStopDebugSession: () => ({ dispose: () => {} }),
          onDidDestroyDebugSession: () => ({ dispose: () => {} }),
          onDidChangeActiveDebugSession: () => ({ dispose: () => {} }),
          sessions: [],
          currentSession: undefined,
          state: 0,
        } as any);
      }
    } catch { /* @theia/debug not available */ }
  }

  // ── Kairo i18n (internationalization) ───────────────────────
  // Must be bound early so all subsequent contributions can inject
  // KairoI18nService for translated labels/tooltips.
  bindKairoI18n(bind, unbind, isBound, rebind);

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
  safeContribution(FrontendApplicationContribution, WorkspaceContextService, 'WorkspaceContextService');

  // ── Kairo contributions ──────────────────────────────────────
  // KAIRO-RC-WEB-2026-07-25-02: KairoViewsContribution and
  // KairoStatusBarContribution both @inject(Container) so they can
  // resolve child services lazily (KairoJavaDebugService depends on
  // the async-resolved @theia/debug DebugSessionManager). InversifyJS
  // does not auto-bind the Container class itself; without this
  // binding every `ctx.container.get(KairoViewsContribution)` fails
  // with "No matching bindings found for serviceIdentifier: _Container"
  // and the safeContribution helper installs a no-op — meaning
  // NO Kairo commands are registered, NO status bar items appear,
  // and the import wizard / build / deploy commands are inaccessible
  // from the command palette. Bind Container to a proxy that
  // delegates to the real container.
  bind(Container).toDynamicValue(ctx => {
    const c = ctx.container;
    return new Proxy(c, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
          return value.bind(target);
        }
        return value;
      },
    }) as unknown as Container;
  });

  bind(KairoStatusBarContribution).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoStatusBarContribution, 'KairoStatusBarContribution');
  bind(KairoViewsContribution).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoViewsContribution, 'KairoViewsContribution');
  // The Kairo views contribution also registers commands
  // (Build / Build & Deploy / Start / Stop / etc.). Bind
  // it as a CommandContribution so Theia's command registry
  // picks up the methods.
  safeContribution(CommandContribution, KairoViewsContribution, 'KairoViewsContribution:cmd');
  safeContribution(KeybindingContribution, KairoViewsContribution, 'KairoViewsContribution:key');
  safeContribution(MenuContribution, KairoViewsContribution, 'KairoViewsContribution:menu');
  bind(KairoJavaDebugService).toSelf().inSingletonScope();
  bind(KairoDebugSessionManager).toService(DebugSessionManager);
  bind(KairoRunConfigurationService).toSelf().inSingletonScope();
  bind(KairoSqlService).toSelf().inSingletonScope();
  safeContribution(CommandContribution, KairoEncodingCommandsContribution, 'KairoEncodingCommandsContribution:cmd');

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
  safeContribution(CommandContribution, KairoFileCommandsContribution, 'KairoFileCommandsContribution:cmd');

  // KairoLargeFileContribution: adaptive large-file performance
  // mode (see kairo-large-file-contribution.ts).
  bind(KairoLargeFileContribution).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoLargeFileContribution, 'KairoLargeFileContribution');
  safeContribution(CommandContribution, KairoLargeFileContribution, 'KairoLargeFileContribution:cmd');
  bind(PreferenceContribution).toConstantValue(KairoLargeFilePreferenceContribution);

  // KairoEditorPreferenceContribution: registers editor.autoSave and
  // editor.autoSaveDelay preferences (B3.1 auto-save strategy).
  bind(PreferenceContribution).toConstantValue(KairoEditorPreferenceContribution);
  bind(KairoEditorAutoSaveSync).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoEditorAutoSaveSync, 'KairoEditorAutoSaveSync');

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
  safeContribution(FrontendApplicationContribution, KairoEditorContribution, 'KairoEditorContribution');
  safeContribution(CommandContribution, KairoEditorContribution, 'KairoEditorContribution:cmd');
  safeContribution(KeybindingContribution, KairoEditorContribution, 'KairoEditorContribution:key');
  safeContribution(MenuContribution, KairoEditorContribution, 'KairoEditorContribution:menu');

  // P2-UX-03: Notification Center — aggregated notifications,
  // bell icon in status bar with unread count badge, expandable
  // history, last 50 items, clearable.
  bind(KairoNotificationServiceImpl).toSelf().inSingletonScope();
  bind(KairoNotificationService).toService(KairoNotificationServiceImpl);
  bind(KairoNotificationCenterContribution).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoNotificationCenterContribution, 'KairoNotificationCenterContribution');
  safeContribution(CommandContribution, KairoNotificationCenterContribution, 'KairoNotificationCenterContribution:cmd');
  bind(KairoNotificationCenterWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_NOTIFICATION_CENTER_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoNotificationCenterWidget),
  })).inSingletonScope();

  // P2-GIT-03: Local History — snapshot timeline, diff, and restore
  bind(LocalHistoryService).toSelf().inSingletonScope();
  bind(LocalHistoryWidget).toSelf();
  bind(LocalHistoryContribution).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, LocalHistoryContribution, 'LocalHistoryContribution');
  safeContribution(CommandContribution, LocalHistoryContribution, 'LocalHistoryContribution:cmd');

  bind(KairoDeploymentsWidget).toSelf();
  bind(KairoRunConfigurationsWidget).toSelf();
  bind(KairoToolbarWidget).toSelf();
  bind(KairoProblemsWidget).toSelf();
  bind(KairoSqlConsoleWidget).toSelf();
  bind(KairoTestResultsWidget).toSelf();
  bind(MavenViewWidget).toSelf();
  bind(KairoTodoWidget).toSelf();
  bind(KairoKeymapWidget).toSelf();

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
  safeContribution(FrontendApplicationContribution, KairoA11yPatchContribution, 'KairoA11yPatchContribution');

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

  // HotDeployService: IDEA-style intelligent hot deployment
  // (auto-sync on save, update application, reload context, frame deactivation)
  bind(HotDeployService).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, HotDeployService, 'HotDeployService');

  // Encoding tab decorator — shows encoding suffix on editor tabs.
  bind(KairoEncodingTabDecorator).toSelf().inSingletonScope();
  bind(TabBarDecorator).toService(KairoEncodingTabDecorator);

  // ── Performance instrumentation ─────────────────────────────
  bind(KairoColdStartTimer).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoColdStartTimer, 'KairoColdStartTimer');
  bind(KairoCompletionTimer).toSelf().inSingletonScope();
  bind(KairoSearchTimer).toSelf().inSingletonScope();
  bind(KairoMemoryTracker).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoMemoryTracker, 'KairoMemoryTracker');
  bind(KairoPerfDashboardWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_PERF_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoPerfDashboardWidget),
  })).inSingletonScope();
  bind(KairoPerfSampler).toSelf().inSingletonScope();
  safeContribution(CommandContribution, KairoPerfSampler, 'KairoPerfSampler:cmd');

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
  safeContribution(CommandContribution, KairoNavigationContribution, 'KairoNavigationContribution:cmd');
  safeContribution(KeybindingContribution, KairoNavigationContribution, 'KairoNavigationContribution:key');

  // ── Kairo Accessibility ───────────────────────────────────────
  bind(KairoScreenReaderService).toSelf().inSingletonScope();
  bind(KairoFocusManagement).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoFocusManagement, 'KairoFocusManagement');
  safeContribution(CommandContribution, KairoFocusManagement, 'KairoFocusManagement:cmd');
  safeContribution(KeybindingContribution, KairoFocusManagement, 'KairoFocusManagement:key');

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
  bind(KairoDebugConditionEditorWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDebugConditionEditorWidget),
  })).inSingletonScope();
  // Debug Diagnostics Widget
  bind(DebugDiagnosticsWidget).toSelf().inSingletonScope();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_DIAGNOSTICS_FACTORY_ID,
    createWidget: () => ctx.container.get(DebugDiagnosticsWidget),
  })).inSingletonScope();

  // ── IDEA-style Debug Tool Window ─────────────────────────────
  bind(KairoDebugToolWindowWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_DEBUG_TOOL_WINDOW_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoDebugToolWindowWidget),
  })).inSingletonScope();

  bind(KairoDebugHoverProvider).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoDebugHoverProvider, 'KairoDebugHoverProvider');

  bind(KairoDebugInlineValuesService).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoDebugInlineValuesService, 'KairoDebugInlineValuesService');

  // ── Kairo Bookmarks ──────────────────────────────────────────
  bind(BookmarkService).toSelf().inSingletonScope();
  bind(KairoBookmarkContribution).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoBookmarkContribution, 'KairoBookmarkContribution');
  safeContribution(CommandContribution, KairoBookmarkContribution, 'KairoBookmarkContribution:cmd');
  safeContribution(KeybindingContribution, KairoBookmarkContribution, 'KairoBookmarkContribution:key');
  bind(KairoBookmarksWidget).toSelf();
  bind(WidgetFactory).toDynamicValue(ctx => ({
    id: KAIRO_BOOKMARKS_FACTORY_ID,
    createWidget: () => ctx.container.get(KairoBookmarksWidget),
  })).inSingletonScope();

  // ── Kairo Shortcut Cheat Sheet ──────────────────────────────
  bind(KairoShortcutCheatsheetContribution).toSelf().inSingletonScope();
  safeContribution(CommandContribution, KairoShortcutCheatsheetContribution, 'KairoShortcutCheatsheetContribution:cmd');
  safeContribution(KeybindingContribution, KairoShortcutCheatsheetContribution, 'KairoShortcutCheatsheetContribution:key');

  // ── IntelliJ IDEA Keymap ─────────────────────────────────────
  // Registers platform-specific IDEA keymaps:
  //   - Windows/Linux: Ctrl-based shortcuts (KairoIDEAWindowsKeymapContribution)
  //   - macOS: Cmd-based shortcuts (KairoIDEAMacKeymapContribution)
  // Each contribution internally guards via isOSX so only the correct
  // platform bindings are applied at runtime.
  bind(KairoIDEAWindowsKeymapContribution).toSelf().inSingletonScope();
  safeContribution(CommandContribution, KairoIDEAWindowsKeymapContribution, 'KairoIDEAWindowsKeymapContribution:cmd');
  safeContribution(KeybindingContribution, KairoIDEAWindowsKeymapContribution, 'KairoIDEAWindowsKeymapContribution:key');

  bind(KairoIDEAMacKeymapContribution).toSelf().inSingletonScope();
  safeContribution(CommandContribution, KairoIDEAMacKeymapContribution, 'KairoIDEAMacKeymapContribution:cmd');
  safeContribution(KeybindingContribution, KairoIDEAMacKeymapContribution, 'KairoIDEAMacKeymapContribution:key');

  // Monaco editor-level IDEA keybindings (all platforms; internally guards per-OS)
  bind(KairoIDEAMonacoKeymapContribution).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoIDEAMonacoKeymapContribution, 'KairoIDEAMonacoKeymapContribution');
  bind(KairoIDEAMacMonacoKeymapContribution).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoIDEAMacMonacoKeymapContribution, 'KairoIDEAMacMonacoKeymapContribution');

  // Browser-only: preventDefault for IDE chords Chrome would otherwise steal,
  // and keep the shell/status-bar geometry correct on 2K / HiDPI screens.
  bind(KairoBrowserKeyboardGuardContribution).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoBrowserKeyboardGuardContribution, 'KairoBrowserKeyboardGuardContribution');
  bind(KairoShellLayoutContribution).toSelf().inSingletonScope();
  safeContribution(FrontendApplicationContribution, KairoShellLayoutContribution, 'KairoShellLayoutContribution');

  // ── Project Structure Dialog ───────────────────────────────
  bind(ProjectStructureContribution).toSelf().inSingletonScope();
  safeContribution(CommandContribution, ProjectStructureContribution, 'ProjectStructureContribution:cmd');
  safeContribution(KeybindingContribution, ProjectStructureContribution, 'ProjectStructureContribution:key');

  // ── SVN Integration ──────────────────────────────────────────
  try {
    bindSvnExtension(bind);
  } catch (e) {
    console.error('[kairo] bindSvnExtension FAILED', e);
  }

  // ── Plugin Extension (VS Code Extension Support) ──────────────
  // KairoExtensionsContribution, KairoExtensionService, and the
  // KairoExtensionsWidget are bound by @kairo/plugin-extension's
  // theiaExtensions module (kairo-extensions-frontend-module.ts).
  // No manual binding needed here — it would cause duplicate
  // channel creation and command registration.
}

export default new ContainerModule((bind, unbind, isBound, rebind) => {
  bindKairoFrontend(bind, unbind, isBound, rebind);
});
