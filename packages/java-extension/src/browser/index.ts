export { KairoJavaService, bindJavaExtension } from './java-service';
export type { JavaServiceState } from './java-service';
export { KairoMavenService } from './maven-service';
export type { MavenDetectResult, MavenDependency, MavenDependencyConflict, MavenDependencyTreeNode, MavenLifecycleTask, MavenRunResult, MavenBuildProgress, MavenViewTab } from './maven-service';
export { AntClasspathService } from './ant-classpath-service';
export type { AntClasspathAnalysis, AntResolveWarning, ClasspathInfo } from './ant-classpath-service';
export { AntClasspathContribution } from './ant-classpath-contribution';
export { MavenViewWidget } from './maven-view-widget';
export { KairoJavaLanguageClientContribution } from './java-language-client-contribution';
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
export { JavaMonacoRegistrationContribution } from './java-monaco-registration';
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
export { KairoJavaDebugContribution, KairoJavaDebugBreakpointCommandContribution, KairoJavaDebugCommands } from './kairo-java-debug-breakpoint-contribution';

// ── Save Actions ────────────────────────────────────────────────
export { JavaSaveActionsService } from './java-save-actions';
export { JavaPreferenceContribution, javaPreferencesSchema } from './java-preference-schema';

// ── Hierarchy (P2-JAVA-01) ────────────────────────────────────────
export { JavaHierarchyWidget } from './java-hierarchy-widget';
export { JavaHierarchyContribution, JavaHierarchyCommands } from './java-hierarchy-contribution';
export type { HierarchyMode } from './java-hierarchy-widget';

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

// ── Override/Implementation Gutter (§7.3 P2-JAVA) ───────────────
export { JavaOverrideGutter } from './java-override-gutter';

// ── Multi-Module Debug (§8.3 P3-ADVDBG-04) ──────────────────────
export { MultiModuleDebugManager } from './java-multi-module-debug';
export type { DebugSession, DebugSessionConfig, DebugSessionState, DebugSessionList, MultiModuleDebugConfig } from './java-multi-module-debug';

// ── Debug Launch Config (P1-DBG-01) ───────────────────────────────
export { KairoJavaDebugLaunchConfigProvider, KAIRO_JAVA_DEBUG_TYPE as _KAIRO_JAVA_DEBUG_TYPE } from './java-debug-launch-config';

// ── HotSwap Service (P3-ADVDBG-01) ─────────────────────────────────
export { JavaHotSwapService } from './java-hotswap-service';
export type { HotSwapHistoryEntry } from './java-hotswap-service';

// ── JUnit Test Runner (P1-TEST-01) ─────────────────────────────────
export { JavaJUnitRunner } from './java-junit-runner';
export type { JUnitTestItem, JUnitTestResult, JUnitTestRun } from './java-junit-runner';

import { interfaces } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { DebugContribution } from '@theia/debug/lib/browser/debug-contribution';
import { DebugAdapterContribution } from '@theia/debug/lib/common/debug-model';
import { KairoJavaLanguageClientContribution } from './java-language-client-contribution';
import { JavaLanguageServerLifecycle } from './java-ls-lifecycle';
import { JavaLanguageClient } from './java-language-client';
import { JavaCompletionProvider } from './java-completion-provider';
import { JavaIntelliSenseProvider } from './java-intellisense-provider';
import { JavaMonacoRegistrationContribution } from './java-monaco-registration';
import { JdtClassFileFsProvider } from './jdt-fs-provider';
import { JavaClassDecompilerContribution } from './java-class-decompiler';
import { JavaDocumentSyncContribution } from './java-document-sync';
import { JavaDiagnosticsManager } from './java-diagnostics-manager';
import { JavaIndexProgressService } from './java-index-progress';
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
import { DebugAcceptanceRunner } from './java-debug-acceptance';
import { JavaSourceMismatchDetector } from './java-debug-source-mismatch';
import { JavaDebugCompatCheck } from './java-debug-compat-check';
import { JavaOverrideGutter } from './java-override-gutter';
import { MultiModuleDebugManager } from './java-multi-module-debug';
import { KairoJavaDebugLaunchConfigProvider } from './java-debug-launch-config';
import { JavaHotSwapService } from './java-hotswap-service';
import { JavaJUnitRunner } from './java-junit-runner';
import { JavaSaveActionsService } from './java-save-actions';
import { JavaPreferenceContribution } from './java-preference-schema';
import { KairoMavenService } from './maven-service';
import { MavenViewWidget } from './maven-view-widget';
import { AntClasspathService } from './ant-classpath-service';
import { AntClasspathContribution } from './ant-classpath-contribution';

export function bindJavaLanguageClientContribution(bind: interfaces.Bind): void {
    bind(KairoJavaLanguageClientContribution).toSelf().inSingletonScope();
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
    bind(JavaMonacoRegistrationContribution).toSelf().inSingletonScope();
    bind(JdtClassFileFsProvider).toSelf().inSingletonScope();
    bind(JavaClassDecompilerContribution).toSelf().inSingletonScope();
    // Registers the Java completion + definition providers with
    // Monaco at application start.
    bind(FrontendApplicationContribution).toService(JavaMonacoRegistrationContribution);
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

    // ── Debug acceptance & source mismatch (P1-DBG-03) ──────────────
    bind(DebugAcceptanceRunner).toSelf().inSingletonScope();
    bind(JavaSourceMismatchDetector).toSelf().inSingletonScope();

    // ── Debug compatibility check (P1-DBG-00) ───────────────────────
    bind(JavaDebugCompatCheck).toSelf().inSingletonScope();

    // ── Override/Implementation Gutter (§7.3 P2-JAVA) ───────────────
    bind(JavaOverrideGutter).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(JavaOverrideGutter);

    // ── Multi-Module Debug (§8.3 P3-ADVDBG-04) ──────────────────────
    bind(MultiModuleDebugManager).toSelf().inSingletonScope();

    // ── Debug Launch Config Provider (P1-DBG-01) ─────────────────────
    bind(KairoJavaDebugLaunchConfigProvider).toSelf().inSingletonScope();
    bind(DebugAdapterContribution).toService(KairoJavaDebugLaunchConfigProvider);

    // ── HotSwap Service (P3-ADVDBG-01) ───────────────────────────────
    bind(JavaHotSwapService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(JavaHotSwapService);

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
}
