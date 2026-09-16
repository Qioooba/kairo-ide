'use strict';

const { register } = require('node:module');
const { pathToFileURL } = require('node:url');
register('data:text/javascript,' + encodeURIComponent(`
export function resolve(specifier, context, nextResolve) {
  if (/\.(css|svg|ttf|woff|woff2|png|jpg|gif)$/.test(specifier)) {
    return { url: 'data:text/javascript,export default {};', format: 'module', shortCircuit: true };
  }
  if (specifier === '@theia/monaco-editor-core' || specifier.includes('monaco-editor-core')) {
    return { url: 'data:text/javascript,export default {};', format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`), pathToFileURL(__filename));

const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom');
enableJSDOM();
global.IS_REACT_ACT_ENVIRONMENT = true;

if (!global.DragEvent) {
  global.DragEvent = class DragEvent extends global.MouseEvent {};
}

if (!global.ResizeObserver) {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

// Mock @theia/monaco-editor-core to avoid the ESM import issue in CJS tests.
// @kairo/ui-kit -> kairo-theme-contribution.ts -> @theia/monaco-editor-core
// which uses ESM `import` that cannot be loaded via `require` in Node CJS mode.
// We intercept the module resolution before the ESM file is ever loaded.
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...args) {
  if (request === '@theia/monaco-editor-core' || request.endsWith('/@theia/monaco-editor-core')) {
    const mockPath = require('node:path').join(__dirname, '__monaco-mock__.js');
    return origResolveFilename.call(this, mockPath, parent, ...args);
  }
  return origResolveFilename.call(this, request, parent, ...args);
};

const { FrontendApplicationConfigProvider } =
  require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

const { test } = require('node:test');
const assert = require('node:assert');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { SearchCenterComponent, groupMatchesByFile, parseGlobInput } =
  require('../../lib/browser/search-center-widget');
const { resolveWorkspaceMatchUri } = require('../../lib/browser/search-path');

const act = React.act;

function mockI18n() {
  return {
    t: (key, params = {}) => {
      if (key === 'widget.search.center.status.empty') return '未找到匹配项';
      if (key === 'widget.search.center.stats.matchInFiles') return `${params.count} 个匹配，在 ${params.fileCount} 个文件中`;
      if (key === 'widget.search.center.stats.match') return `${params.count} 个匹配`;
      if (key === 'widget.search.center.status.error') return `搜索失败: ${params.message}`;
      return String(key);
    },
    onDidChangeLanguage: () => ({ dispose: () => {} }),
  };
}

function state(status, overrides = {}) {
  return {
    status,
    requestId: 1,
    matches: [],
    totalMatches: 0,
    truncated: false,
    erroredFiles: [],
    ...overrides,
  };
}

function mount(initialState, callbacks = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = {
    state: initialState,
    onSearch: callbacks.onSearch || (() => undefined),
    onCancel: callbacks.onCancel || (() => undefined),
    onOpen: callbacks.onOpen || (() => undefined),
    onClose: callbacks.onClose || (() => undefined),
    i18n: mockI18n(),
  };
  act(() => root.render(React.createElement(SearchCenterComponent, props)));
  return {
    container,
    rerender(nextState) {
      props.state = nextState;
      act(() => root.render(React.createElement(SearchCenterComponent, props)));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function setInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

test('groupMatchesByFile preserves file and match order', () => {
  const matches = [
    { file: 'A.java', line: 1 },
    { file: 'B.java', line: 2 },
    { file: 'A.java', line: 3 },
  ];
  const groups = groupMatchesByFile(matches);
  assert.deepStrictEqual(groups.map(group => group.file), ['A.java', 'B.java']);
  assert.deepStrictEqual(groups[0].matches.map(match => match.line), [1, 3]);
});

test('parseGlobInput trims, removes blanks and deduplicates filters', () => {
  assert.deepStrictEqual(parseGlobInput(' **/*.java, ,src/**,**/*.java '), ['**/*.java', 'src/**']);
  assert.strictEqual(parseGlobInput(' , '), undefined);
});

test('resolveWorkspaceMatchUri accepts relative paths and rejects workspace escapes', () => {
  assert.match(resolveWorkspaceMatchUri('/workspace/project', 'src\\A.java').toString(), /workspace\/project\/src\/A\.java$/);
  for (const unsafe of ['../secret.txt', 'src/../../secret.txt', '/etc/passwd', 'C:\\secret.txt', 'file:///etc/passwd', 'https://example.test/x', '%2e%2e/secret.txt']) {
    assert.throws(() => resolveWorkspaceMatchUri('/workspace/project', unsafe), /Unsafe|escapes/);
  }
});

test('renders loading, empty, error and cancelled states with working cancel', () => {
  let cancellations = 0;
  const view = mount(state('loading'), { onCancel: () => cancellations++ });
  try {
    assert.ok(view.container.querySelector('[data-testid="search-loading"]'));
    const cancelBtn = view.container.querySelector('[data-testid="search-cancel"]');
    assert.ok(cancelBtn, 'cancel button should exist in loading state');
    act(() => cancelBtn.click());
    assert.strictEqual(cancellations, 1);

    view.rerender(state('empty'));
    assert.match(view.container.querySelector('[data-testid="search-empty"]').textContent, /未找到匹配项/);

    view.rerender(state('error', { error: new Error('agent unavailable') }));
    assert.match(view.container.querySelector('[data-testid="search-error"]').textContent, /agent unavailable/);

    view.rerender(state('cancelled'));
    assert.ok(view.container.querySelector('[data-testid="search-cancelled"]'));
  } finally {
    view.unmount();
  }
});

test('groups results, reports total count and opens selected match with keyboard', () => {
  const matches = [
    { file: 'src/A.java', line: 4, column: 2, matchText: 'needle', contextBefore: 'a ', contextAfter: ' b' },
    { file: 'src/A.java', line: 8, column: 1, matchText: 'needle', contextBefore: '', contextAfter: '' },
    { file: 'web/B.jsp', line: 3, column: 5, matchText: 'needle', contextBefore: '', contextAfter: '' },
  ];
  const opened = [];
  const view = mount(state('results', { matches, totalMatches: 3 }), { onOpen: match => opened.push(match) });
  try {
    assert.strictEqual(view.container.querySelectorAll('[data-testid="search-group"]').length, 2);
    assert.strictEqual(view.container.querySelectorAll('[data-testid="search-result"]').length, 3);
    const countText = view.container.querySelector('[data-testid="search-count"]').textContent.trim();
    assert.match(countText, /3 个匹配/);
    assert.match(countText, /2 个文件/);

    const modal = view.container.querySelector('[data-testid="search-center-modal"]');
    act(() => modal.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    act(() => {
      const enterEvent = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      modal.dispatchEvent(enterEvent);
    });
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(opened[0].line, 8);
  } finally {
    view.unmount();
  }
});

test('submits query and filter toggles', async () => {
  const submitted = [];
  const view = mount(state('idle'), { onSearch: query => submitted.push(query) });
  try {
    setInput(view.container.querySelector('[data-testid="search-query"]'), '  TODO  ');
    act(() => view.container.querySelector('[data-testid="filter-case"]').click());
    act(() => view.container.querySelector('[data-testid="filter-word"]').click());
    act(() => view.container.querySelector('[data-testid="filter-regex"]').click());
    await act(async () => {
      view.container.querySelector('[data-testid="search-form"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });

    assert.deepStrictEqual(submitted, [{
      query: 'TODO',
      isRegex: true,
      caseSensitive: true,
      wholeWord: true,
      include: undefined,
      exclude: undefined,
      scope: 'project',
    }]);
  } finally {
    view.unmount();
  }
});

test('submits IDEA file mask as include/exclude globs', async () => {
  const submitted = [];
  const view = mount(state('idle'), { onSearch: query => submitted.push(query) });
  try {
    setInput(view.container.querySelector('[data-testid="search-query"]'), 'needle');
    setInput(view.container.querySelector('[data-testid="filter-file-types"]'), '*.java, !*.min.js, xml');
    await act(async () => {
      view.container.querySelector('[data-testid="search-form"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.deepStrictEqual(submitted[0].include, ['*.java', '*.xml']);
    assert.deepStrictEqual(submitted[0].exclude, ['*.min.js']);
  } finally {
    view.unmount();
  }
});

test('allows a new query while loading so the session model can cancel the stale request', async () => {
  const submitted = [];
  const view = mount(state('loading'), { onSearch: query => submitted.push(query) });
  try {
    setInput(view.container.querySelector('[data-testid="search-query"]'), 'new query');
    assert.strictEqual(view.container.querySelector('[data-testid="search-submit"]').disabled, false);
    await act(async () => {
      view.container.querySelector('[data-testid="search-form"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.strictEqual(submitted.length, 1);
    assert.strictEqual(submitted[0].query, 'new query');
  } finally {
    view.unmount();
  }
});

test('open failures are caught and rendered instead of becoming unhandled rejections', async () => {
  const match = { file: '../escape.java', line: 1, column: 1, matchText: 'x', contextBefore: '', contextAfter: '' };
  const view = mount(state('results', { matches: [match], totalMatches: 1 }), { onOpen: async () => { throw new Error('Unsafe search result path'); } });
  try {
    await act(async () => view.container.querySelector('[data-testid="search-result"]').click());
    assert.match(view.container.querySelector('[data-testid="search-error"]').textContent, /Unsafe search result path/);
  } finally {
    view.unmount();
  }
});

test('Enter opens a match but keeps the IDEA-style dialog open', async () => {
  const match = { file: 'src/A.java', line: 4, column: 2, matchText: 'needle', contextBefore: 'a ', contextAfter: ' b' };
  let closed = 0;
  const opened = [];
  const view = mount(state('results', { matches: [match], totalMatches: 1 }), {
    onOpen: m => opened.push(m),
    onClose: () => { closed++; },
  });
  try {
    const modal = view.container.querySelector('[data-testid="search-center-modal"]');
    act(() => {
      modal.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    assert.strictEqual(opened.length, 1);
    assert.strictEqual(closed, 0, 'Enter must not close the Find dialog (IDEA behavior)');
  } finally {
    view.unmount();
  }
});

test('Open in Find Window footer button is wired', async () => {
  const match = { file: 'src/A.java', line: 1, column: 1, matchText: 'x', contextBefore: '', contextAfter: '' };
  let pinned = 0;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = {
    state: state('results', { matches: [match], totalMatches: 1 }),
    onSearch: () => undefined,
    onCancel: () => undefined,
    onOpen: () => undefined,
    onClose: () => undefined,
    onOpenInFindWindow: () => { pinned++; },
    i18n: mockI18n(),
  };
  act(() => root.render(React.createElement(SearchCenterComponent, props)));
  try {
    const btn = container.querySelector('[data-testid="open-find-window"]');
    assert.ok(btn, 'Open in Find Window button should render when results exist');
    act(() => btn.click());
    assert.strictEqual(pinned, 1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

test('submits result limits from the advanced row', async () => {
  const submitted = [];
  const view = mount(state('idle'), { onSearch: query => submitted.push(query) });
  try {
    setInput(view.container.querySelector('[data-testid="search-query"]'), 'needle');
    act(() => view.container.querySelector('[data-testid="toggle-advanced"]').click());
    setInput(view.container.querySelector('[data-testid="filter-max-results"]'), '5000');
    setInput(view.container.querySelector('[data-testid="filter-display-limit"]'), '100');
    await act(async () => {
      view.container.querySelector('[data-testid="search-form"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.strictEqual(submitted[0].maxResults, 5000);
    assert.strictEqual(submitted[0].displayLimit, 100);
  } finally {
    view.unmount();
  }
});

test('omits result limits when the advanced boxes are empty', async () => {
  const submitted = [];
  const view = mount(state('idle'), { onSearch: query => submitted.push(query) });
  try {
    setInput(view.container.querySelector('[data-testid="search-query"]'), 'needle');
    await act(async () => {
      view.container.querySelector('[data-testid="search-form"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.ok(!('maxResults' in submitted[0]), 'maxResults must stay unset by default');
    assert.ok(!('displayLimit' in submitted[0]), 'displayLimit must stay unset by default');
  } finally {
    view.unmount();
  }
});

test('caps rendered matches per displayLimit and shows a hint', () => {
  const matches = [
    { file: 'src/A.java', line: 1, column: 1, matchText: 'needle', contextBefore: '', contextAfter: '' },
    { file: 'src/A.java', line: 2, column: 1, matchText: 'needle', contextBefore: '', contextAfter: '' },
    { file: 'src/B.java', line: 3, column: 1, matchText: 'needle', contextBefore: '', contextAfter: '' },
  ];
  const view = mount(state('results', {
    matches,
    totalMatches: 3,
    options: { query: 'needle', isRegex: false, caseSensitive: false, wholeWord: false, workspaceId: 'w', displayLimit: 2 },
  }));
  try {
    assert.strictEqual(view.container.querySelectorAll('[data-testid="search-result"]').length, 2);
    assert.ok(view.container.querySelector('[data-testid="search-display-capped"]'));
  } finally {
    view.unmount();
  }
});
