'use strict';

/**
 * Tests for Kairo debug widget factory IDs and wiring.
 * Verifies that the debug widget factory IDs are defined,
 * the widget classes are importable, and the frontend
 * module registers them correctly.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspaceRoot = path.resolve(__dirname, '../../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), 'utf8');
}

test('debug widget factory IDs are defined in kairo-factory-ids.ts', () => {
  const factoryIds = read('packages/theia-product/src/main/browser/kairo-factory-ids.ts');
  assert.match(factoryIds, /KAIRO_DEBUG_VARIABLES_FACTORY_ID/);
  assert.match(factoryIds, /KAIRO_DEBUG_CALLSTACK_FACTORY_ID/);
  assert.match(factoryIds, /KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID/);
  assert.match(factoryIds, /kairo-debug-variables/);
  assert.match(factoryIds, /kairo-debug-callstack/);
  assert.match(factoryIds, /kairo-debug-breakpoints/);
});

test('debug widgets are registered in the frontend module', () => {
  const frontendModule = read('packages/theia-product/src/main/browser/kairo-product-frontend-module.ts');
  assert.match(frontendModule, /KairoDebugVariablesWidget/);
  assert.match(frontendModule, /KairoDebugCallStackWidget/);
  assert.match(frontendModule, /KairoDebugBreakpointsWidget/);
  assert.match(frontendModule, /KAIRO_DEBUG_VARIABLES_FACTORY_ID/);
  assert.match(frontendModule, /KAIRO_DEBUG_CALLSTACK_FACTORY_ID/);
  assert.match(frontendModule, /KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID/);
});

test('debug view commands are registered in views contribution', () => {
  const viewsContribution = read('packages/theia-product/src/main/browser/kairo-views-contribution.tsx');
  assert.match(viewsContribution, /REVEAL_KAIRO_DEBUG_VARIABLES/);
  assert.match(viewsContribution, /REVEAL_KAIRO_DEBUG_CALLSTACK/);
  assert.match(viewsContribution, /REVEAL_KAIRO_DEBUG_BREAKPOINTS/);
  assert.match(viewsContribution, /kairo.debug.view.variables/);
  assert.match(viewsContribution, /kairo.debug.view.callstack/);
  assert.match(viewsContribution, /kairo.debug.view.breakpoints/);
});

test('debug variables widget file exists and exports correct class', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-variables-widget.tsx');
  assert.match(widget, /KairoDebugVariablesWidget/);
  assert.match(widget, /KAIRO_DEBUG_VARIABLES_FACTORY_ID/);
  assert.match(widget, /class KairoDebugVariablesWidget extends ReactWidget/);
  assert.match(widget, /DebugSessionManager/);
});

test('debug callstack widget file exists and exports correct class', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-callstack-widget.tsx');
  assert.match(widget, /KairoDebugCallStackWidget/);
  assert.match(widget, /KAIRO_DEBUG_CALLSTACK_FACTORY_ID/);
  assert.match(widget, /class KairoDebugCallStackWidget extends ReactWidget/);
  assert.match(widget, /DebugSessionManager/);
  assert.match(widget, /KairoDebugSessionService/);
});

test('debug breakpoints widget file exists and exports correct class', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-breakpoints-widget.tsx');
  assert.match(widget, /KairoDebugBreakpointsWidget/);
  assert.match(widget, /KAIRO_DEBUG_BREAKPOINTS_FACTORY_ID/);
  assert.match(widget, /class KairoDebugBreakpointsWidget extends ReactWidget/);
  assert.match(widget, /BreakpointManager/);
  assert.match(widget, /enableBreakpoint/);
  assert.match(widget, /removeBreakpoint/);
});

test('debug widgets do not replace native Theia Debug UI', () => {
  const sessionWidget = read('node_modules/@theia/debug/lib/browser/view/debug-session-widget.d.ts');
  for (const widget of [
    'DebugThreadsWidget',
    'DebugStackFramesWidget',
    'DebugBreakpointsWidget',
    'DebugVariablesWidget',
    'DebugWatchWidget',
  ]) {
    assert.match(sessionWidget, new RegExp(widget), `${widget} must remain part of the native Debug view`);
  }

  const frontendModule = read('packages/theia-product/src/main/browser/kairo-product-frontend-module.ts');
  assert.doesNotMatch(frontendModule, /rebind.*DebugSessionWidget/);
  assert.doesNotMatch(frontendModule, /rebind.*DebugVariablesWidget/);
  assert.doesNotMatch(frontendModule, /rebind.*DebugStackFramesWidget/);
  assert.doesNotMatch(frontendModule, /rebind.*DebugBreakpointsWidget/);
});

test('debug widgets follow the Kairo ReactWidget pattern', () => {
  for (const fileName of [
    'debug-variables-widget.tsx',
    'debug-callstack-widget.tsx',
    'debug-breakpoints-widget.tsx',
  ]) {
    const content = read(`packages/theia-product/src/main/browser/${fileName}`);
    assert.match(content, /extends ReactWidget/);
    assert.match(content, /@postConstruct\(\)/);
    assert.match(content, /protected render\(\)/);
    assert.match(content, /React.createElement/);
    assert.match(content, /addClass\('kairo-widget'\)/);
  }
});

test('debug toolbar widget has all step control buttons', () => {
  const toolbar = read('packages/theia-product/src/main/browser/debug-toolbar-widget.tsx');
  assert.match(toolbar, /KairoDebugToolbarWidget/);
  assert.match(toolbar, /KAIRO_DEBUG_TOOLBAR_FACTORY_ID/);
  assert.match(toolbar, /codicon-debug-continue/);
  assert.match(toolbar, /codicon-debug-step-over/);
  assert.match(toolbar, /codicon-debug-step-into/);
  assert.match(toolbar, /codicon-debug-step-out/);
  assert.match(toolbar, /codicon-debug-stop/);
  assert.match(toolbar, /codicon-debug-restart/);
  assert.match(toolbar, /continue_\(\)/);
  assert.match(toolbar, /stepOver\(\)/);
  assert.match(toolbar, /stepInto\(\)/);
  assert.match(toolbar, /stepOut\(\)/);
  assert.match(toolbar, /stop\(\)/);
  assert.match(toolbar, /restart\(\)/);
});

test('debug toolbar disables buttons based on state', () => {
  const toolbar = read('packages/theia-product/src/main/browser/debug-toolbar-widget.tsx');
  assert.match(toolbar, /continueDisabled/);
  assert.match(toolbar, /stepOverDisabled/);
  assert.match(toolbar, /stepIntoDisabled/);
  assert.match(toolbar, /stepOutDisabled/);
  assert.match(toolbar, /stopDisabled/);
  assert.match(toolbar, /restartDisabled/);
  assert.match(toolbar, /isSuspended/);
  assert.match(toolbar, /isRunning/);
  assert.match(toolbar, /isTerminated/);
});

test('debug console widget has expression evaluation', () => {
  const console = read('packages/theia-product/src/main/browser/debug-console-widget.tsx');
  assert.match(console, /KairoDebugConsoleWidget/);
  assert.match(console, /KAIRO_DEBUG_CONSOLE_FACTORY_ID/);
  assert.match(console, /evaluate\(/);
  assert.match(console, /sendRequest\('evaluate'/);
  assert.match(console, /history/);
  assert.match(console, /ArrowUp/);
  assert.match(console, /ArrowDown/);
});

test('debug watch widget is defined', () => {
  const watch = read('packages/theia-product/src/main/browser/debug-watch-widget.tsx');
  assert.match(watch, /KairoDebugWatchWidget/);
  assert.match(watch, /KAIRO_DEBUG_WATCH_FACTORY_ID/);
  assert.match(watch, /class KairoDebugWatchWidget extends ReactWidget/);
});

test('debug session service provides centralized session state', () => {
  const service = read('packages/theia-product/src/main/browser/kairo-debug-session-service.ts');
  assert.match(service, /KairoDebugSessionService/);
  assert.match(service, /class KairoDebugSessionService/);
  assert.match(service, /onDidChangeState/);
  assert.match(service, /currentState/);
  assert.match(service, /currentSession/);
  assert.match(service, /refreshState\(\)/);
  assert.match(service, /KairoDebugSessionState/);
  assert.match(service, /debugState/);
  assert.match(service, /isSuspended/);
  assert.match(service, /isRunning/);
  assert.match(service, /hasSession/);
});

test('debug session service has batch variable processing', () => {
  const service = read('packages/theia-product/src/main/browser/kairo-debug-session-service.ts');
  assert.match(service, /batchGetVariables/);
  assert.match(service, /BatchVariableResult/);
  assert.match(service, /Promise\.allSettled/);
  assert.match(service, /getScopesAndVariables/);
});

test('debug session service has DAP command methods', () => {
  const service = read('packages/theia-product/src/main/browser/kairo-debug-session-service.ts');
  assert.match(service, /continue\(\)/);
  assert.match(service, /stepOver\(\)/);
  assert.match(service, /stepInto\(\)/);
  assert.match(service, /stepOut\(\)/);
  assert.match(service, /stop\(\)/);
  assert.match(service, /evaluate\(/);
  assert.match(service, /getVariables\(/);
});

test('debug session service is registered in frontend module', () => {
  const frontendModule = read('packages/theia-product/src/main/browser/kairo-product-frontend-module.ts');
  assert.match(frontendModule, /KairoDebugSessionService/);
  assert.match(frontendModule, /bind\(KairoDebugSessionService\)/);
});

test('variables widget uses batch variable processing', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-variables-widget.tsx');
  assert.match(widget, /KairoDebugSessionService/);
  assert.match(widget, /debugSessionService/);
  assert.match(widget, /getScopesAndVariables/);
  assert.match(widget, /variable\.children = children/);
  assert.match(widget, /variable\.childrenLoaded/);
});

test('toolbar widget uses centralized session service', () => {
  const toolbar = read('packages/theia-product/src/main/browser/debug-toolbar-widget.tsx');
  assert.match(toolbar, /KairoDebugSessionService/);
  assert.match(toolbar, /debugSessionService/);
  assert.match(toolbar, /debugSessionService\.currentState/);
  assert.match(toolbar, /debugSessionService\.continue/);
  assert.match(toolbar, /debugSessionService\.stepOver/);
  assert.match(toolbar, /debugSessionService\.stepInto/);
  assert.match(toolbar, /debugSessionService\.stepOut/);
  assert.match(toolbar, /debugSessionService\.stop/);
});

// ── Phase 3+: New Debug Widget Tests ─────────────────────────────

test('java hotswap factory ID defined; empty-shell module/hotswap-status IDs removed', () => {
  const factoryIds = read('packages/theia-product/src/main/browser/kairo-factory-ids.ts');
  assert.match(factoryIds, /KAIRO_JAVA_HOTSWAP_FACTORY_ID/);
  assert.doesNotMatch(factoryIds, /KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID/);
  assert.doesNotMatch(factoryIds, /KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID/);
  assert.match(factoryIds, /KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID/);
});

test('empty-shell module selector / hotswap status are not registered in frontend module', () => {
  const frontendModule = read('packages/theia-product/src/main/browser/kairo-product-frontend-module.ts');
  assert.doesNotMatch(frontendModule, /KairoDebugModuleSelectorWidget/);
  assert.doesNotMatch(frontendModule, /KairoDebugHotSwapStatusWidget/);
  assert.match(frontendModule, /KairoDebugConditionEditorWidget/);
  assert.match(frontendModule, /KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID/);
});

test('java hotswap widget is wired in java-extension frontend module', () => {
  const javaModule = read('packages/java-extension/src/browser/index.ts');
  assert.match(javaModule, /HotSwapWidget/);
  assert.match(javaModule, /KAIRO_HOTSWAP_WIDGET_ID/);
  assert.match(javaModule, /WidgetFactory/);
});

test('condition editor widget file exists and follows ReactWidget pattern', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /KairoDebugConditionEditorWidget/);
  assert.match(widget, /KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID/);
  assert.match(widget, /class KairoDebugConditionEditorWidget extends ReactWidget/);
  assert.match(widget, /@postConstruct\(\)/);
  assert.match(widget, /protected render\(\)/);
  assert.match(widget, /addClass\('kairo-widget'\)/);
});

test('condition editor widget supports all filter types', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /FilterType/);
  assert.match(widget, /filterType.*condition/);
  assert.match(widget, /filterType.*thread/);
  assert.match(widget, /filterType.*instance/);
  assert.match(widget, /filterType.*stackDepth/);
  assert.match(widget, /filterType.*hitCount/);
});

test('condition editor widget has expression validation', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /validateCondition/);
  assert.match(widget, /isValid/);
  assert.match(widget, /validationMessage/);
  assert.match(widget, /invalidExpression/);
  // TP-P2-4: no length>0 fallback that accepts arbitrary non-empty strings
  assert.doesNotMatch(widget, /condition\.trim\(\)\.length\s*>\s*0/);
  assert.match(widget, /hasCompare|hasLogic|hasCallOrMember/);
});

test('condition editor widget has AND/OR/NOT operator support', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /&&/);
  assert.match(widget, /\|\|/);
  assert.match(widget, /AND/);
  assert.match(widget, /OR/);
  assert.match(widget, /NOT/);
});

test('condition editor widget has clear and apply buttons', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /onClear/);
  assert.match(widget, /onApply/);
  assert.match(widget, /conditionEditor\.clear/);
  assert.match(widget, /conditionEditor\.apply/);
});

test('condition editor widget has thread filter input', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /threadFilter/);
  assert.match(widget, /conditionEditor\.threadLabel/);
});

test('condition editor widget has instance filter input', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /instanceFilter/);
  assert.match(widget, /conditionEditor\.instanceLabel/);
});

test('condition editor widget has stack depth filter inputs', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /stackDepthMin/);
  assert.match(widget, /stackDepthMax/);
  assert.match(widget, /conditionEditor\.stackLabel|stackDepth/);
});

test('condition editor widget has hit count filter', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /hitCountMode/);
  assert.match(widget, /hitCountTarget/);
  assert.match(widget, /conditionEditor\.hitCount|hitCount/);
});

test('debug console addEntry is immutable and capped (TP-P2-7)', () => {
  const source = read('packages/theia-product/src/main/browser/debug-console-widget.tsx');
  assert.match(source, /MAX_ENTRIES|MAX_CONSOLE_ENTRIES/);
  assert.match(source, /slice\(-/);
  assert.doesNotMatch(source, /this\.state\.entries\.push\(/);
});

test('debug console subscribes to DAP output events (TP-P2-20)', () => {
  const source = read('packages/theia-product/src/main/browser/debug-console-widget.tsx');
  assert.match(source, /session\.on\('output'/);
  assert.match(source, /handleDapOutput/);
  assert.match(source, /stderr/);
  assert.match(source, /stdout/);
});

test('debug watches idea uses immutable updates and workspace storage (TP-P2-8/9)', () => {
  const source = read('packages/theia-product/src/main/browser/debug-watches-idea.tsx');
  assert.match(source, /workspaceKey/);
  assert.match(source, /WATCH_STORAGE_PREFIX|kairo-debug-watches:/);
  assert.match(source, /entriesRef/);
  assert.match(source, /updateChildTree/);
  assert.doesNotMatch(source, /entry\.children\s*=/);
  assert.doesNotMatch(source, /child\.children\s*=/);
});

test('debug breakpoints Enable/Disable All uses per-breakpoint API (TP-P2-13)', () => {
  const source = read('packages/theia-product/src/main/browser/debug-breakpoints-widget.tsx');
  assert.match(source, /enableAllBreakpoints/);
  assert.doesNotMatch(source, /breakpointsEnabled\s*=\s*!/);
});

test('debug inline values avoid == and full-file scans (TP-P2-14)', () => {
  const source = read('packages/theia-product/src/main/browser/debug-inline-values.ts');
  assert.match(source, /stripStringLiterals/);
  assert.match(source, /collectScanLines/);
  assert.match(source, /getVisibleRanges/);
  assert.match(source, /=\(\?!=\)/);
});

test('debug collapsible section has aria keyboard support (TP-P3-7)', () => {
  const source = read('packages/theia-product/src/main/browser/debug-collapsible-section.tsx');
  assert.match(source, /aria-expanded/);
  assert.match(source, /role="button"/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /Enter/);
});

test('callstack widget has no dead _mapStackTraceFrame (TP-P3-2)', () => {
  const source = read('packages/theia-product/src/main/browser/debug-callstack-widget.tsx');
  assert.doesNotMatch(source, /_mapStackTraceFrame/);
});

test('callstack widget uses focusFrame API for honest frame selection (TP-P1-4)', () => {
  const callstack = read('packages/theia-product/src/main/browser/debug-callstack-widget.tsx');
  const service = read('packages/theia-product/src/main/browser/kairo-debug-session-service.ts');
  const framesIdea = read('packages/theia-product/src/main/browser/debug-frames-idea.tsx');

  assert.match(service, /async focusFrame\(frameId: number\)/);
  assert.match(service, /thread\.currentFrame = target/);
  assert.match(service, /thread\.fetchFrames\(\)/);

  assert.match(callstack, /debugSessionService\.focusFrame/);
  assert.match(callstack, /thread\.fetchFrames\(\)/);
  assert.doesNotMatch(callstack, /thread\.currentFrame\s*=/);
  assert.match(callstack, /focused\.open\(/);

  assert.match(framesIdea, /sessionService\.focusFrame/);
  assert.doesNotMatch(framesIdea, /setCurrentFrameId\(frame\.id\)[\s\S]*onSelectFrame/);
});

test('run configurations delete uses ConfirmDialog (TP-P2-12)', () => {
  const source = read('packages/theia-product/src/main/browser/kairo-run-configurations-widget.tsx');
  assert.match(source, /ConfirmDialog/);
  assert.doesNotMatch(source, /window\.confirm/);
});

test('local history render avoids innerHTML table (TP-P2-16)', () => {
  const source = read('packages/theia-product/src/main/browser/kairo-local-history.ts');
  assert.match(source, /replaceChildren|createElement\('table'\)/);
  assert.doesNotMatch(source, /this\.node\.innerHTML\s*=\s*`[\s\S]*kairo-deployments-table/);
});

test('status bar avoids bare spaces and empty workspaceId (TP-P2-19)', () => {
  const source = read('packages/theia-product/src/main/browser/kairo-status-bar-contribution.ts');
  assert.doesNotMatch(source, /workspaceId:\s*''/);
  assert.match(source, /workspaceContext\.context\?\.workspaceId/);
  assert.match(source, /extras \?/);
});

test('debug hover/variables use theme CSS variables without Darcula hex (TP-P2-18)', () => {
  const hover = read('packages/theia-product/src/main/browser/debug-hover-widget.tsx');
  const vars = read('packages/theia-product/src/main/browser/debug-variables-idea.tsx');
  assert.match(hover, /--theia-widget-shadow|--theia-editor-inactiveSelectionBackground/);
  assert.doesNotMatch(vars, /#6a8759|#6897bb|#a9b7c6|#c0c0c0|#b5b6e3/);
});

test('browser keymap smartSelect avoids ctrl+w remap overlap (TP-P3-9)', () => {
  const source = read('packages/theia-product/src/main/browser/kairo-idea-windows-keymap.ts');
  assert.match(source, /smartSelect\.expand/);
  assert.match(source, /alt\+shift\+w/);
  // Remap table must not also claim ctrl+w (handled explicitly for smartSelect)
  const remapBlock = source.match(/const BROWSER_CHROME_REMAPS[\s\S]*?\n\};/);
  assert.ok(remapBlock, 'BROWSER_CHROME_REMAPS block present');
  assert.doesNotMatch(remapBlock[0], /'ctrl\+w'/);
  assert.match(source, /smartSelect\.expand[\s\S]*alt\+shift\+w|alt\+shift\+w[\s\S]*smartSelect\.expand/);
});
