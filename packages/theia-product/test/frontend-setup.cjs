// Centralized frontend test setup for Kairo widget/service integration tests.
//
// This module is designed to be required at the very top of a Node test file
// that transitively loads Theia browser modules. It stubs the pieces that
// cannot run in a Node/CJS environment:
//
//   - @theia/monaco-editor-core and its ESM subpaths (Monaco ships ESM .js
//     that Node tries to parse as CJS and throws "Cannot use import statement").
//   - @theia/monaco and its subpaths.
//   - xterm / xterm-addon-* (avoid canvas/WebGL initialization in jsdom).
//   - p-queue (ESM-only dependency that some Theia modules pull in).
//   - CSS requires/imports.
//
// It also sets up jsdom, browser globals that Theia expects at module-load
// time, and the FrontendApplicationConfigProvider singleton.
//
// Usage:
//   require('../../../test/frontend-setup.cjs'); // from src/main/browser/*.test.cjs
//
// Keep this file CommonJS so it can be required from .cjs test files without
// any --import/--loader flags.

'use strict';

const Module = require('module');
const path = require('path');

// ------------------------------------------------------------------
// 1. CSS stub (CJS path)
// ------------------------------------------------------------------

Module._extensions['.css'] = function (mod, filename) {
  mod._compile('module.exports = {};', filename);
};

// ------------------------------------------------------------------
// 2. Generic proxy stub factory
// ------------------------------------------------------------------

function makeFunctionStub(name) {
  const fn = function stub() {};
  try {
    Object.defineProperty(fn, 'name', { value: name, configurable: true });
  } catch {}
  return fn;
}

function makeNamedClass(name) {
  // eslint-disable-next-line no-new-func
  const Cls = { [name]: class {} }[name];
  return Cls;
}

/**
 * Create a module stub whose named exports are lazily-created function stubs,
 * but with a few well-known named exports backed by real classes/objects so
 * that `class X extends importedClass {}` and common Monaco service patterns
 * do not throw.
 */
function createProxyModule(baseName) {
  const defaultClass = makeNamedClass(baseName || 'MonacoStub');
  const known = new Map();

  // The root @theia/monaco-editor-core namespace is used as `monaco` in
  // several Theia modules (e.g. `monaco.editor.TrackedRangeStickiness`).
  // Provide a minimal editor namespace so those lookups do not throw.
  if (baseName === 'MonacoModule') {
    known.set('editor', {
      TrackedRangeStickiness: {
        AlwaysGrowsWhenTypingAtEdges: 0,
        NeverGrowsWhenTypingAtEdges: 1,
        GrowsOnlyWhenTypingBefore: 2,
        GrowsOnlyWhenTypingAfter: 3,
      },
      EndOfLineSequence: { LF: 0, CRLF: 1 },
      ScrollType: { Smooth: 0, Immediate: 1 },
      MouseTargetType: {
        UNKNOWN: 0, TEXTAREA: 1, GUTTER_GLYPH_MARGIN: 2, GUTTER_LINE_NUMBERS: 3,
        GUTTER_LINE_DECORATIONS: 4, GUTTER_VIEW_ZONE: 5, CONTENT_VIEW_ZONE: 6,
        CONTENT_EMPTY: 7, CONTENT_TEXT: 8, CONTENT_FOREIGN: 9,
        CONTENT_WIDGET: 10, OVERVIEW_RULER: 11, SCROLLBAR: 12, OVERLAY_WIDGET: 13,
        OUTSIDE_EDITOR: 14,
      },
      EditorType: { ICodeEditor: 'vs.editor.ICodeEditor', IDiffEditor: 'vs.editor.IDiffEditor' },
      WrappingIndent: { None: 0, Same: 1, Indent: 2, DeepIndent: 3 },
      RenderLineNumbersType: { Off: 0, On: 1, Relative: 2, Interval: 3, Custom: 4 },
      OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
      MinimapPosition: { Inline: 1, Gutter: 2 },
    });
    known.set('languages', {
      CompletionItemKind: {
        Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5, Class: 6,
        Struct: 7, Interface: 8, Module: 9, Property: 10, Unit: 11, Value: 12, Enum: 13,
        Keyword: 14, Snippet: 15, Color: 16, File: 17, Reference: 18, Folder: 19,
        EnumMember: 20, Constant: 21, TypeParameter: 22,
      },
      CompletionItemInsertTextRule: { KeepWhitespace: 1, InsertAsSnippet: 4 },
      SymbolKind: {
        File: 1, Module: 2, Namespace: 3, Package: 4, Class: 5, Method: 6, Property: 7,
        Field: 8, Constructor: 9, Enum: 10, Interface: 11, Function: 12, Variable: 13,
        Constant: 14, String: 15, Number: 16, Boolean: 17, Array: 18, Object: 19,
        Key: 20, Null: 21, EnumMember: 22, Struct: 23, Event: 24, Operator: 25, TypeParameter: 26,
      },
      SymbolTag: { Deprecated: 1 },
      InlayHintKind: { Type: 1, Parameter: 2 },
      CodeActionKind: {
        QuickFix: 'quickfix', Refactor: 'refactor', Source: 'source',
        SourceOrganizeImports: 'source.organizeImports', SourceFixAll: 'source.fixAll',
      },
      DocumentHighlightKind: { Text: 1, Read: 2, Write: 3 },
    });
    known.set('Uri', class Uri {
      constructor(uri) { this.uri = uri; }
      static parse(uri) { return new Uri(uri); }
      static file(uri) { return new Uri(uri); }
      toString() { return String(this.uri); }
    });
    known.set('Position', class Position {
      constructor(lineNumber, column) {
        this.lineNumber = lineNumber;
        this.column = column;
      }
    });
    known.set('Range', class Range {
      constructor(startLineNumber, startColumn, endLineNumber, endColumn) {
        this.startLineNumber = startLineNumber;
        this.startColumn = startColumn;
        this.endLineNumber = endLineNumber;
        this.endColumn = endColumn;
      }
    });
    known.set('CancellationTokenSource', makeNamedClass('CancellationTokenSource'));
    // iconRegistry.getIconRegistry() is called at module-load time by
    // @theia/plugin-ext/lib/main/browser/theme-icon-override.js. Return a
    // stub so registerIcon() does not throw in Node tests.
    known.set('getIconRegistry', () => ({ registerIcon: () => ({ dispose: () => {} }) }));
  }

  function ensureKnown(prop) {
    if (known.has(prop)) return known.get(prop);
    let value;
    switch (prop) {
      // Monaco classes that are extended by Theia.
      case 'StandaloneCodeEditor':
      case 'TextModel':
      case 'EditorAction':
      case 'EditorCommand':
      case 'Action':
      case 'ContextKeyExpr':
      case 'ContextKeyExpression':
      case 'MarkdownRenderer':
      case 'CodeEditorWidget':
      case 'DiffEditorWidget':
      case 'EmbeddedCodeEditorWidget':
      case 'EmbeddedDiffEditorWidget':
      case 'StandaloneServices':
      case 'StandaloneThemeService':
      case 'LanguageService':
      case 'ModelService':
      case 'LanguageFeatureRegistry':
      case 'CommandsRegistry':
      case 'MenuRegistry':
      case 'KeybindingsRegistry':
      case 'Color':
      case 'ThemeIcon':
        value = makeNamedClass(prop);
        break;

      // Monaco singletons / service helpers.
      case 'StandaloneServices':
        value = {
          initialize: () => {},
          get: () => createProxyModule('ServiceInstance'),
          has: () => false,
          register: () => {},
        };
        break;
      case 'InstantiationService':
        value = makeNamedClass('InstantiationService');
        value.createInstance = function () { return createProxyModule('Instance'); };
        value.invokeFunction = function (fn) { return fn && fn(); };
        value.createChild = function () { return new value(); };
        break;
      case 'ServiceCollection':
        value = makeNamedClass('ServiceCollection');
        value.prototype.set = function () { return this; };
        value.prototype.get = function () { return undefined; };
        break;
      case 'CommandsRegistry':
        value = { registerCommand: () => ({ dispose: () => {} }) };
        break;
      case 'MenuRegistry':
        value = { appendMenuItem: () => ({ dispose: () => {} }), addCommand: () => {} };
        break;
      case 'KeybindingsRegistry':
        value = { registerKeybindingRule: () => {} };
        break;
      case 'LanguageFeatureRegistry':
        value = makeNamedClass('LanguageFeatureRegistry');
        value.prototype.register = function () { return { dispose: () => {} }; };
        break;

      // editorOptions symbols used by Kairo.
      case 'ShowLightbulbIconMode':
        value = { Off: 0, On: 1, OnCode: 2 };
        break;
      case 'ModelDecorationOptions':
        value = { register: () => ({}) };
        break;
      case 'EditorOption':
        value = {};
        break;
      case 'WrappingIndent':
        value = { None: 0, Same: 1, Indent: 2, DeepIndent: 3 };
        break;
      case 'RenderLineNumbersType':
        value = { Off: 0, On: 1, Relative: 2, Interval: 3, Custom: 4 };
        break;
      case 'OverviewRulerLane':
        value = { Left: 1, Center: 2, Right: 4, Full: 7 };
        break;
      case 'MinimapPosition':
        value = { Inline: 1, Gutter: 2 };
        break;
      case 'InUntrustedWorkspace':
        value = { InTrustedWorkspace: 0, InUntrustedWorkspace: 1, InRestrictedMode: 2 };
        break;

      default:
        value = makeFunctionStub(prop);
    }
    known.set(prop, value);
    return value;
  }

  return new Proxy(defaultClass, {
    get(_target, prop) {
      if (prop === 'default') return defaultClass;
      if (prop === '__esModule') return true;
      if (typeof prop !== 'string') return undefined;
      return ensureKnown(prop);
    },
    apply(_target, thisArg, args) {
      return new defaultClass(...args);
    },
    construct(_target, args) {
      return new defaultClass(...args);
    },
  });
}

// ------------------------------------------------------------------
// 3. Module._load interception
// ------------------------------------------------------------------

function isMonacoRequest(request) {
  return request === '@theia/monaco-editor-core' || request.startsWith('@theia/monaco-editor-core/');
}

function isTheiaMonacoRequest(request) {
  return request === '@theia/monaco' || request.startsWith('@theia/monaco/');
}

function isXtermRequest(request) {
  return request === 'xterm' || request.startsWith('xterm-addon-');
}

function makeXtermModule(request) {
  if (request === 'xterm') {
    const Terminal = class Terminal {
      constructor() {
        this.rows = 24;
        this.cols = 80;
      }
      open() {}
      dispose() {}
      write() {}
      writeln() {}
      clear() {}
      reset() {}
      resize() {}
      onData() { return { dispose: () => {} }; }
      onResize() { return { dispose: () => {} }; }
      onTitleChange() { return { dispose: () => {} }; }
      onBell() { return { dispose: () => {} }; }
      onCursorMove() { return { dispose: () => {} }; }
      onLineFeed() { return { dispose: () => {} }; }
      onScroll() { return { dispose: () => {} }; }
      onSelectionChange() { return { dispose: () => {} }; }
      loadAddon() {}
      attachCustomKeyEventHandler() {}
      registerLinkProvider() { return { dispose: () => {} }; }
      registerMarker() { return undefined; }
      registerDecoration() { return undefined; }
      get buffer() { return { active: {}, base: {}, alt: {} }; }
      get markers() { return []; }
      get selection() { return undefined; }
      get selectedText() { return ''; }
      static get strings() { return {}; }
    };
    return { Terminal };
  }
  // xterm-addon-webgl / xterm-addon-fit / any other addon
  const Addon = class Addon {
    activate() {}
    dispose() {}
  };
  return { WebglAddon: Addon, FitAddon: Addon, [request.split('-').pop()]: Addon };
}

function makePQueueModule() {
  return class PQueue {
    constructor() {
      this.size = 0;
      this.pending = 0;
    }
    add(fn) { return Promise.resolve(fn && fn()); }
    addAll() { return Promise.resolve([]); }
    pause() {}
    start() {}
    clear() {}
    onEmpty() { return Promise.resolve(); }
    onIdle() { return Promise.resolve(); }
  };
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (isMonacoRequest(request)) {
    return createProxyModule('MonacoModule');
  }
  if (isTheiaMonacoRequest(request)) {
    if (request.includes('/monaco-workspace')) {
      return { MonacoWorkspace: makeNamedClass('MonacoWorkspace') };
    }
    if (request.includes('/monaco-editor-provider')) {
      const Provider = makeNamedClass('MonacoEditorProvider');
      Provider.inlineOptions = { scrollbar: { alwaysConsumeMouseWheel: false } };
      return { MonacoEditorProvider: Provider };
    }
    return createProxyModule('TheiaMonacoModule');
  }
  if (isXtermRequest(request)) {
    return makeXtermModule(request);
  }
  if (request === 'p-queue') {
    return makePQueueModule();
  }
  return originalLoad.apply(this, arguments);
};

// ------------------------------------------------------------------
// 4. jsdom + browser globals
// ------------------------------------------------------------------

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
const disableJSDOM = enableJSDOM();

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {
    constructor(type, init) {
      super(type, init);
      this.dataTransfer = (init && init.dataTransfer) || null;
    }
  };
}
if (!global.DataTransfer) {
  global.DataTransfer = class DataTransfer {
    constructor() { this.data = new Map(); }
    setData(type, value) { this.data.set(type, value); }
    getData(type) { return this.data.get(type) || ''; }
    clearData() { this.data.clear(); }
  };
}
if (!global.ResizeObserver) {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!global.IntersectionObserver) {
  global.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement canvas getContext; xterm and webgl addon try to
// create contexts at module-load time. Return a permissive stub so they do not
// throw before tests can run.
const canvasGetContext = global.HTMLCanvasElement && global.HTMLCanvasElement.prototype.getContext;
if (canvasGetContext) {
  const contextProxy = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'canvas') return { width: 0, height: 0 };
      return function ctxStub() { return undefined; };
    },
  });
  global.HTMLCanvasElement.prototype.getContext = function (type, options) {
    if (type === '2d' || type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      return contextProxy;
    }
    return canvasGetContext.call(this, type, options);
  };
}

// ------------------------------------------------------------------
// 5. Theia frontend configuration
// ------------------------------------------------------------------

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

// ------------------------------------------------------------------
// 6. reflect-metadata (required by inversify decorators at load time)
// ------------------------------------------------------------------

require('reflect-metadata');

// ------------------------------------------------------------------
// 7. Teardown helper
// ------------------------------------------------------------------

module.exports = { disableJSDOM };
