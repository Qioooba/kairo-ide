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
  assert.match(widget, /OpenerService/);
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
  assert.match(service, /onDidStateChange/);
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

test('module selector widget factory ID is defined in kairo-factory-ids.ts', () => {
  const factoryIds = read('packages/theia-product/src/main/browser/kairo-factory-ids.ts');
  assert.match(factoryIds, /KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID/);
  assert.match(factoryIds, /kairo-debug-module-selector/);
});

test('condition editor widget factory ID is defined in kairo-factory-ids.ts', () => {
  const factoryIds = read('packages/theia-product/src/main/browser/kairo-factory-ids.ts');
  assert.match(factoryIds, /KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID/);
  assert.match(factoryIds, /kairo-debug-condition-editor/);
});

test('hotswap status widget factory ID is defined in kairo-factory-ids.ts', () => {
  const factoryIds = read('packages/theia-product/src/main/browser/kairo-factory-ids.ts');
  assert.match(factoryIds, /KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID/);
  assert.match(factoryIds, /kairo-debug-hotswap-status/);
});

test('new debug widgets are registered in the frontend module', () => {
  const frontendModule = read('packages/theia-product/src/main/browser/kairo-product-frontend-module.ts');
  assert.match(frontendModule, /KairoDebugModuleSelectorWidget/);
  assert.match(frontendModule, /KairoDebugConditionEditorWidget/);
  assert.match(frontendModule, /KairoDebugHotSwapStatusWidget/);
  assert.match(frontendModule, /KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID/);
  assert.match(frontendModule, /KAIRO_DEBUG_CONDITION_EDITOR_FACTORY_ID/);
  assert.match(frontendModule, /KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID/);
});

test('module selector widget file exists and follows ReactWidget pattern', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-module-selector-widget.tsx');
  assert.match(widget, /KairoDebugModuleSelectorWidget/);
  assert.match(widget, /KAIRO_DEBUG_MODULE_SELECTOR_FACTORY_ID/);
  assert.match(widget, /class KairoDebugModuleSelectorWidget extends ReactWidget/);
  assert.match(widget, /@postConstruct\(\)/);
  assert.match(widget, /protected render\(\)/);
  assert.match(widget, /addClass\('kairo-widget'\)/);
});

test('module selector widget has toggle, select all, and deselect all', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-module-selector-widget.tsx');
  assert.match(widget, /toggleModule/);
  assert.match(widget, /selectAll/);
  assert.match(widget, /deselectAll/);
  assert.match(widget, /setModules/);
  assert.match(widget, /ModuleInfo/);
  assert.match(widget, /ModuleSelectorState/);
});

test('module selector widget has enabled/disabled state per module', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-module-selector-widget.tsx');
  assert.match(widget, /m\.enabled/);
  assert.match(widget, /allEnabled/);
  assert.match(widget, /checkbox/);
  assert.match(widget, /breakpointCount/);
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
  assert.match(widget, /Invalid expression syntax/);
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
  assert.match(widget, /Clear/);
  assert.match(widget, /Apply/);
});

test('condition editor widget has thread filter input', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /threadFilter/);
  assert.match(widget, /Thread ID or Name Pattern/);
});

test('condition editor widget has instance filter input', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /instanceFilter/);
  assert.match(widget, /Instance Filter/);
});

test('condition editor widget has stack depth filter inputs', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /stackDepthMin/);
  assert.match(widget, /stackDepthMax/);
  assert.match(widget, /Call Stack Depth Range/);
});

test('condition editor widget has hit count filter', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-condition-editor-widget.tsx');
  assert.match(widget, /hitCountMode/);
  assert.match(widget, /hitCountTarget/);
  assert.match(widget, /Hit Count Condition/);
});

test('hotswap status widget file exists and follows ReactWidget pattern', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-hotswap-status-widget.tsx');
  assert.match(widget, /KairoDebugHotSwapStatusWidget/);
  assert.match(widget, /KAIRO_DEBUG_HOTSWAP_STATUS_FACTORY_ID/);
  assert.match(widget, /class KairoDebugHotSwapStatusWidget extends ReactWidget/);
  assert.match(widget, /@postConstruct\(\)/);
  assert.match(widget, /protected render\(\)/);
  assert.match(widget, /addClass\('kairo-widget'\)/);
});

test('hotswap status widget has all status types', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-hotswap-status-widget.tsx');
  assert.match(widget, /HotSwapStatusType/);
  assert.match(widget, /pending/);
  assert.match(widget, /in_progress/);
  assert.match(widget, /completed/);
  assert.match(widget, /failed/);
  assert.match(widget, /rolled_back/);
  assert.match(widget, /not_supported/);
});

test('hotswap status widget has rollback and rollback all', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-hotswap-status-widget.tsx');
  assert.match(widget, /onRollback/);
  assert.match(widget, /onRollbackAll/);
  assert.match(widget, /rollback\(/);
  assert.match(widget, /rollbackAll\(/);
  assert.match(widget, /Rollback All/);
});

test('hotswap status widget has clear history', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-hotswap-status-widget.tsx');
  assert.match(widget, /clearHistory\(\)/);
  assert.match(widget, /onClear/);
});

test('hotswap status widget has addEntry method', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-hotswap-status-widget.tsx');
  assert.match(widget, /addEntry\(/);
  assert.match(widget, /className/);
  assert.match(widget, /methodsChanged/);
  assert.match(widget, /errorMessage/);
});

test('hotswap status widget has canRedefine support', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-hotswap-status-widget.tsx');
  assert.match(widget, /setCanRedefine/);
  assert.match(widget, /canRedefine/);
  assert.match(widget, /REDEFINE OK/);
  assert.match(widget, /UNAVAILABLE/);
});

test('hotswap status widget has status badge rendering', () => {
  const widget = read('packages/theia-product/src/main/browser/debug-hotswap-status-widget.tsx');
  assert.match(widget, /statusBadge/);
  assert.match(widget, /codicon-pass/);
  assert.match(widget, /codicon-error/);
  assert.match(widget, /codicon-discard/);
  assert.match(widget, /codicon-sync~spin/);
});