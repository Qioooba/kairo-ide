export { KairoJavaService, bindJavaExtension } from './java-service';
export type { JavaServiceState } from './java-service';
export { KairoMavenService } from './maven-service';
export type { MavenDetectResult, MavenDependency, MavenDependencyConflict, MavenDependencyTreeNode, MavenLifecycleTask, MavenRunResult, MavenBuildProgress, MavenViewTab } from './maven-service';
export { AntClasspathService } from './ant-classpath-service';
export type { AntClasspathAnalysis, AntResolveWarning, ClasspathInfo } from './ant-classpath-service';
export { AntClasspathContribution } from './ant-classpath-contribution';
export { MavenViewWidget } from './maven-view-widget';
export {
  JavaLanguageServerLifecycle,
  extractWorkspaceDataDir,
  extractJdtLsHome,
  pathToFileUri,
  JDT_LS_MAX_AUTO_RESTARTS,
  JDT_LS_RESTART_BASE_DELAY_MS,
  JDT_LS_RESTART_MAX_DELAY_MS,
} from './java-ls-lifecycle';
export type { JdtLsLaunchDescriptor } from './java-ls-lifecycle';
export { JavaLanguageClient } from './java-language-client';
export { JavaCompletionProvider } from './java-completion-provider';
export { JavaIntelliSenseProvider } from './java-intellisense-provider';
export type {
  JavaIntelliSenseCompletionItem,
  JavaIntelliSenseCompletionResult,
  JavaIntelliSenseDefinition,
  JavaIntelliSenseDiagnostic,
} from './java-intellisense-provider';
export { JavaMonacoRegistrationContribution, adaptCompletionItem } from './java-monaco-registration';
export { registerJavaLiveTemplates } from './java-live-templates';
export { globalRecentCompletions } from './java-recent-completions';
export { JavaUserLiveTemplatesService } from './java-user-templates';
export type { JavaLiveTemplatesOptions } from './java-live-templates';
export { computeCompleteStatement } from './java-complete-statement';
export { SURROUND_TEMPLATES, computeSurroundEdit, findSurroundTemplate } from './java-surround-with';
export type { SurroundTemplate } from './java-surround-with';
export { computeUnwrapEdit } from './java-unwrap';
export { JAVA_MONARCH } from './java-monarch';
export {
  applyKairoLanguageEditorDefaults,
  scheduleProgressiveTokenization,
  KAIRO_LANGUAGE_EDITOR_DEFAULTS,
  KAIRO_SYNTAX_LANGUAGE_IDS,
} from './monaco-tokenization-config';
export { JdtClassFileFsProvider } from './jdt-fs-provider';
export { JavaClassDecompilerContribution } from './java-class-decompiler';
export { JavaDocumentSyncContribution } from './java-document-sync';
export { JavaDocumentSync, lspDiagnosticsToMarkers, toMonacoMarkerSeverity, JAVA_DOCUMENT_SYNC_DEBOUNCE_MS } from './java-document-sync-core';
export type { JavaDocumentSnapshot, JavaMarkerData } from './java-document-sync-core';
export { JavaDiagnosticsManager, JAVA_DIAGNOSTICS_OWNER, JAVA_DIAGNOSTICS_KIND } from './java-diagnostics-manager';
export type { JavaCompletionRequest, JavaCompletionResponse, JavaCompletionResponseItem, JavaDefinitionResponse } from './java-completion-provider';
export { JavaIndexProgressService } from './java-index-progress';
export type { IndexProgress } from './java-index-progress';
export { JavaOrganizeImports } from './java-organize-imports';
export type { OrganizeImportsResult } from './java-organize-imports';
export { JavaSafeDelete } from './java-safe-delete';
export type { SafeDeletePreview, SafeDeleteResult } from './java-safe-delete';
export { JavaRefactoring } from './java-refactoring';
export type { RefactoringResult } from './java-refactoring';
export { ProjectModelManager, type ProjectModelOptions, type RevisionChangeListener } from './project-model';
export { KairoJavaDebugContribution, KairoJavaDebugBreakpointCommandContribution, KairoJavaDebugCommands } from './kairo-java-debug-breakpoint-contribution';

// ── Save Actions ────────────────────────────────────────────────
export { JavaSaveActionsService } from './java-save-actions';
export { JavaPreferenceContribution, javaPreferencesSchema } from './java-preference-schema';

// ── Hierarchy (P2-JAVA-01) ────────────────────────────────────────
export { JavaHierarchyWidget } from './java-hierarchy-widget';
export { JavaHierarchyContribution, JavaHierarchyCommands } from './java-hierarchy-contribution';
export type { HierarchyMode } from './java-hierarchy-widget';

// ── IDEA-style Navigation ────────────────────────────────────────
export { JavaNavigationContribution, JavaNavigationCommands } from './java-navigation-contribution';
export { JavaReferencesWidget } from './java-references-widget';
export {
  prepareUsages,
  sortUsages,
  buildUsagePickEntries,
  filterUsages,
  fileNameFromUri,
  relativePathFromUri,
} from './java-show-usages';
export type { PreparedUsage, UsagePickEntry } from './java-show-usages';

// ── Debug services (P2-DBG-02) ───────────────────────────────────
export { JavaExceptionBreakpointService, JAVA_EXCEPTION_FILTERS } from './java-debug-exception-breakpoints';
export type { ExceptionBreakpointState } from './java-debug-exception-breakpoints';
export { JavaJvmProcessLister } from './java-debug-jvm-lister';
export type { JvmProcess, ManualAttachTarget, JvmListState } from './java-debug-jvm-lister';
export { JavaBreakpointManager } from './java-debug-breakpoint-manager';
export type { BreakpointGroup } from './java-debug-breakpoint-manager';
export { JavaThreadSwitchHelper } from './java-debug-thread-helper';
export type { ThreadInfo, ThreadListState } from './java-debug-thread-helper';

// ── Debug acceptance & source mismatch (P1-DBG-03) ──────────────
export { DebugAcceptanceRunner, DEBUG_STATE_TRANSITIONS, ERROR_RECOVERY_PATHS, runDebugAcceptance, isValidTransition, getRecoverySuggestion } from './java-debug-acceptance';
export type { DebugAcceptanceState, DebugStateTransition, StepTiming, DebugAcceptanceResult, DebugAcceptanceConfig } from './java-debug-acceptance';
export { JavaSourceMismatchDetector } from './java-debug-source-mismatch';
export type { SourceMismatchEntry, SourceMismatchReport } from './java-debug-source-mismatch';

// ── Debug compatibility check (P1-DBG-00) ───────────────────────
export { JavaDebugCompatCheck } from './java-debug-compat-check';
export type { CompatCheckItem, CompatCheckReport, CompatCheckConfig } from './java-debug-compat-check';

// ── Debug End-to-End Capabilities (PR14 / T47~T50) ───────────────
export {
  BreakpointMigrationCoordinator,
  JavaDebugCapabilitiesPipeline,
  VariablePagingManager,
  DebugStopGenerationManager,
  DebugDisconnectPolicy,
  SteppingFilterManager,
  ExceptionBreakpointManager,
  DEFAULT_VARIABLE_PAGE_SIZE,
  MAX_VARIABLE_PAGE_SIZE,
} from './java-debug-capabilities';
export type {
  ManagedBreakpoint,
  DapSourceBreakpointPayload,
  AdapterCapabilities,
  VmEvaluationContext,
} from './java-debug-capabilities';

// ── Startup & Performance Observability (PR15) ────────────────────
export {
  StartupStageTracker,
  WorkspaceFileManifestCache,
  ResourceBudgetManager,
  DEFAULT_WORKSPACE_EXCLUDES,
  DEFAULT_4GB_BUDGET,
} from './startup-performance-tracker';
export type {
  StartupStageListener,
} from './startup-performance-tracker';


// ── Override/Implementation Gutter (§7.3 P2-JAVA) ───────────────
export { JavaOverrideGutter } from './java-override-gutter';

// ── Debug Launch Config (P1-DBG-01) ───────────────────────────────
export { KairoJavaDebugLaunchConfigProvider, KAIRO_JAVA_DEBUG_TYPE as _KAIRO_JAVA_DEBUG_TYPE } from './java-debug-launch-config';

// ── HotSwap Service (P3-ADVDBG-01) ─────────────────────────────────
export { JavaHotSwapService } from './java-hotswap-service';
export type { HotSwapHistoryEntry } from './java-hotswap-service';
export { HotSwapWidget, KAIRO_HOTSWAP_WIDGET_ID } from './java-hotswap-widget';

// ── JUnit Test Runner (P1-TEST-01) ─────────────────────────────────
export { JavaJUnitRunner } from './java-junit-runner';
export type { JUnitTestItem, JUnitTestResult, JUnitTestRun } from './java-junit-runner';

// ── One-click Java Run/Debug (IDEA-style) ───────────────────────────
export { JavaRunService } from './java-run-service';
export { JavaRunCommandContribution, JavaRunMenuContribution, JavaRunCommands } from './java-run-commands';
export type { RunJavaParams, RunJavaResult, JavaClassInfo, JavaMethodInfo } from './java-run-protocol';

import { interfaces } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { KeybindingContribution } from '@theia/core/lib/browser/keybinding';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { DebugContribution } from '@theia/debug/lib/browser/debug-contribution';
import { DebugAdapterContribution } from '@theia/debug/lib/common/debug-model';
import { JavaLanguageServerLifecycle } from './java-ls-lifecycle';
import { JavaLanguageClient } from './java-language-client';
import { JavaCompletionProvider } from './java-completion-provider';
import { JavaIntelliSenseProvider } from './java-intellisense-provider';
import { JavaMonacoRegistrationContribution } from './java-monaco-registration';
import { JavaUserLiveTemplatesService } from './java-user-templates';
import { JdtClassFileFsProvider } from './jdt-fs-provider';
import { JavaClassDecompilerContribution } from './java-class-decompiler';
import { JavaDocumentSyncContribution } from './java-document-sync';
import { JavaDiagnosticsManager } from './java-diagnostics-manager';
import { JavaIndexProgressService } from './java-index-progress';
import { JavaIndexProgressUiContribution } from './java-index-progress-ui';
import { JavaOrganizeImports } from './java-organize-imports';
import { JavaSafeDelete } from './java-safe-delete';
import { JavaRefactoring } from './java-refactoring';
import { KairoJavaDebugContribution, KairoJavaDebugBreakpointCommandContribution } from './kairo-java-debug-breakpoint-contribution';
import { JavaExceptionBreakpointService } from './java-debug-exception-breakpoints';
import { JavaJvmProcessLister } from './java-debug-jvm-lister';
import { JavaBreakpointManager } from './java-debug-breakpoint-manager';
import { JavaThreadSwitchHelper } from './java-debug-thread-helper';
import { JavaHierarchyContribution } from './java-hierarchy-contribution';
import { JavaHierarchyWidget } from './java-hierarchy-widget';
import { JavaNavigationContribution } from './java-navigation-contribution';
import { JavaReferencesWidget } from './java-references-widget';
import { DebugAcceptanceRunner } from './java-debug-acceptance';
import { JavaSourceMismatchDetector } from './java-debug-source-mismatch';
import { JavaDebugCompatCheck } from './java-debug-compat-check';
import { JavaOverrideGutter } from './java-override-gutter';
import { KairoJavaDebugLaunchConfigProvider } from './java-debug-launch-config';
import { JavaHotSwapService } from './java-hotswap-service';
import { HotSwapWidget, KAIRO_HOTSWAP_WIDGET_ID } from './java-hotswap-widget';
import { JavaJUnitRunner } from './java-junit-runner';
import { JavaSaveActionsService } from './java-save-actions';
import { JavaPreferenceContribution } from './java-preference-schema';
import { KairoMavenService } from './maven-service';
import { MavenViewWidget } from './maven-view-widget';
import { AntClasspathService } from './ant-classpath-service';
import { AntClasspathContribution } from './ant-classpath-contribution';
import { JavaRunService } from './java-run-service';
import { JavaRunCommandContribution, JavaRunMenuContribution } from './java-run-commands';

export function bindJavaLanguageClientContribution(bind: interfaces.Bind): void {
    bind(JavaLanguageServerLifecycle).toSelf().inSingletonScope();
    // Bound as a FrontendApplicationContribution so Theia
    // instantiates the lifecycle at startup — without this the
    // service is never constructed and the prepare /
    // launch-descriptor / start chain never runs. Its
    // @postConstruct must stay synchronous (see the LazyInSync
    // comment in java-ls-lifecycle.ts).
    bind(FrontendApplicationContribution).toService(JavaLanguageServerLifecycle);
    bind(JavaLanguageClient).toSelf().inSingletonScope();
    bind(JavaCompletionProvider).toSelf().inSingletonScope();
    bind(JavaIntelliSenseProvider).toSelf().inSingletonScope();
    bind(JavaUserLiveTemplatesService).toSelf().inSingletonScope();
    bind(JavaMonacoRegistrationContribution).toSelf().inSingletonScope();
    bind(JdtClassFileFsProvider).toSelf().inSingletonScope();
    bind(JavaClassDecompilerContribution).toSelf().inSingletonScope();
    // Registers the Java completion + definition providers with
    // Monaco at application start.
    bind(FrontendApplicationContribution).toService(JavaMonacoRegistrationContribution);
    bind(CommandContribution).toService(JavaMonacoRegistrationContribution);
    bind(MenuContribution).toService(JavaMonacoRegistrationContribution);
    // Decompiles standalone .class files opened from disk and
    // ensures jdt:// library classes get Java highlighting.
    bind(FrontendApplicationContribution).toService(JavaClassDecompilerContribution);
    bind(JavaDocumentSyncContribution).toSelf().inSingletonScope();
    // Syncs open Java editor buffers (didOpen/didChange/didClose)
    // to the JDT LS and renders backend diagnostics as markers.
    bind(FrontendApplicationContribution).toService(JavaDocumentSyncContribution);
    bind(JavaDiagnosticsManager).toSelf().inSingletonScope();
    // Registers JDT LS diagnostics with the Theia MarkerManager
    // so they appear in the Problems panel alongside editor markers.
    bind(FrontendApplicationContribution).toService(JavaDiagnosticsManager);
    bind(JavaIndexProgressService).toSelf().inSingletonScope();
    bind(JavaIndexProgressUiContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(JavaIndexProgressUiContribution);
    bind(CommandContribution).toService(JavaIndexProgressUiContribution);
    bind(JavaOrganizeImports).toSelf().inSingletonScope();
    bind(JavaSafeDelete).toSelf().inSingletonScope();
    bind(JavaRefactoring).toSelf().inSingletonScope();

    // Debug breakpoint contributions — conditional breakpoints, hit count,
    // log points, and evaluate expression for the kairo-java debug type.
    bind(KairoJavaDebugContribution).toSelf().inSingletonScope();
    bind(DebugContribution).toService(KairoJavaDebugContribution);
    bind(KairoJavaDebugBreakpointCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(KairoJavaDebugBreakpointCommandContribution);
    bind(MenuContribution).toService(KairoJavaDebugBreakpointCommandContribution);

    // ── Debug services (P2-DBG-02): exception breakpoints, JVM
    // lister, breakpoint groups/mute/persistence, thread switching.
    bind(JavaExceptionBreakpointService).toSelf().inSingletonScope();
    bind(JavaJvmProcessLister).toSelf().inSingletonScope();
    bind(JavaBreakpointManager).toSelf().inSingletonScope();
    bind(JavaThreadSwitchHelper).toSelf().inSingletonScope();

    // ── Hierarchy (P2-JAVA-01) ──────────────────────────────────────
    bind(JavaHierarchyContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(JavaHierarchyContribution);
    bind(MenuContribution).toService(JavaHierarchyContribution);
    bind(JavaHierarchyWidget).toSelf();

    // ── Find Usages / References Panel ────────────────────────────
    bind(JavaReferencesWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
      id: JavaReferencesWidget.ID,
      createWidget: () => ctx.container.get(JavaReferencesWidget),
    })).inSingletonScope();

    // ── IDEA-style Navigation ─────────────────────────────────────
    bind(JavaNavigationContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(JavaNavigationContribution);
    bind(MenuContribution).toService(JavaNavigationContribution);
    bind(KeybindingContribution).toService(JavaNavigationContribution);

    // ── Debug acceptance & source mismatch (P1-DBG-03) ──────────────
    bind(DebugAcceptanceRunner).toSelf().inSingletonScope();
    bind(JavaSourceMismatchDetector).toSelf().inSingletonScope();

    // ── Debug compatibility check (P1-DBG-00) ───────────────────────
    bind(JavaDebugCompatCheck).toSelf().inSingletonScope();

    // ── Override/Implementation Gutter (§7.3 P2-JAVA) ───────────────
    bind(JavaOverrideGutter).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(JavaOverrideGutter);

    // ── Debug Launch Config Provider (P1-DBG-01) ─────────────────────
    bind(KairoJavaDebugLaunchConfigProvider).toSelf().inSingletonScope();
    bind(DebugAdapterContribution).toService(KairoJavaDebugLaunchConfigProvider);

    // ── HotSwap Service (P3-ADVDBG-01) ───────────────────────────────
    bind(JavaHotSwapService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(JavaHotSwapService);
    bind(HotSwapWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
      id: KAIRO_HOTSWAP_WIDGET_ID,
      createWidget: () => ctx.container.get(HotSwapWidget),
    })).inSingletonScope();

    // ── JUnit Test Runner (P1-TEST-01) ───────────────────────────────
    bind(JavaJUnitRunner).toSelf().inSingletonScope();

    // ── Save Actions: format-on-save & organize-imports-on-save ──────
    bind(JavaSaveActionsService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(JavaSaveActionsService);

    // ── Java Preferences ─────────────────────────────────────────────
    bind(PreferenceContribution).toConstantValue(JavaPreferenceContribution);

    // ── Maven View ───────────────────────────────────────────────────
    bind(KairoMavenService).toSelf().inSingletonScope();
    bind(MavenViewWidget).toSelf();

    // ── Ant Classpath Service ─────────────────────────────────────────
    bind(AntClasspathService).toSelf().inSingletonScope();
    bind(AntClasspathContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AntClasspathContribution);

    // ── One-click Java Run/Debug (IDEA-style) ────────────────────────
    bind(JavaRunService).toSelf().inSingletonScope();
    bind(JavaRunCommandContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(JavaRunCommandContribution);
    bind(JavaRunMenuContribution).toSelf().inSingletonScope();
    bind(MenuContribution).toService(JavaRunMenuContribution);
}
