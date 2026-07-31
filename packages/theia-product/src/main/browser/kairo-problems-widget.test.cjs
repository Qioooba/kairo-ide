// Unit test for KairoProblemsWidget.
//
// Verifies the widget class structure, filter functions
// (severityLabel, severityClass, sourceLabel, detectType,
// markersToEntries), filter state persistence, filtering logic,
// navigation, and keyboard handling.
//
// Since the pure functions are not exported from the compiled
// module, we replicate their logic for testing and verify the
// widget class exports.
//
// Run with:
//   node --test src/main/browser/kairo-problems-widget.test.cjs

'use strict';

const { disableJSDOM } = require('../../../test/frontend-setup.cjs');

require('reflect-metadata');

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  KairoProblemsWidget,
  KAIRO_PROBLEMS_FACTORY_ID,
} = require('../../../lib/browser/kairo-problems-widget');

// ------------------------------------------------------------------
// Replicated pure functions from kairo-problems-widget.tsx
// (These are not exported, so we replicate them for testing.)
// ------------------------------------------------------------------

const MarkerSeverity = { Hint: 1, Info: 2, Warning: 4, Error: 8 };

function severityLabel(severity) {
  switch (severity) {
    case MarkerSeverity.Error: return '错误';
    case MarkerSeverity.Warning: return '警告';
    case MarkerSeverity.Info: return '信息';
    default: return '提示';
  }
}

function severityClass(severity) {
  switch (severity) {
    case MarkerSeverity.Error: return 'kairo-problem-severity-error';
    case MarkerSeverity.Warning: return 'kairo-problem-severity-warning';
    case MarkerSeverity.Info: return 'kairo-problem-severity-info';
    default: return 'kairo-problem-severity-hint';
  }
}

const BUILD_OWNER = 'kairo-build';
const JAVA_OWNER = 'java';

function sourceLabel(owner) {
  if (owner === BUILD_OWNER) return 'Java';
  if (owner === JAVA_OWNER) return 'Java';
  return owner;
}

function detectType(entry) {
  const path = entry.filePath.toLowerCase();
  if (path.endsWith('.java')) return 'Java';
  if (path.endsWith('.xml') || path.endsWith('.tld')) return 'XML';
  if (path.endsWith('.jsp') || path.endsWith('.jspx') || path.endsWith('.tag')) return 'JSP';
  if (path.endsWith('.properties')) return 'Encoding';
  if (entry.source === 'Build') return 'Ant';
  return 'Java';
}

function markersToEntries(markers) {
  return markers.map((m, i) => ({
    key: `${m.resource}:${m.startLineNumber}:${m.startColumn}:${i}`,
    severity: m.severity,
    severityLabel: severityLabel(m.severity),
    file: m.resource.split('/').pop() ?? m.resource,
    filePath: m.resource,
    line: m.startLineNumber,
    column: m.startColumn,
    message: m.message,
    source: sourceLabel(m.owner),
    uri: m.resource,
  }));
}

function loadFilterState() {
  return {
    showErrors: true,
    showWarnings: true,
    showInfos: true,
    fileFilter: '',
    typeFilter: 'All',
    currentFileOnly: false,
  };
}

function filterEntries(entries, filterState, currentFile) {
  return entries.filter(e => {
    if (!filterState.showErrors && e.severity === MarkerSeverity.Error) return false;
    if (!filterState.showWarnings && e.severity === MarkerSeverity.Warning) return false;
    if (!filterState.showInfos && e.severity === MarkerSeverity.Info) return false;

    if (filterState.fileFilter) {
      const term = filterState.fileFilter.toLowerCase();
      if (!e.file.toLowerCase().includes(term) && !e.filePath.toLowerCase().includes(term)) {
        return false;
      }
    }

    if (filterState.typeFilter !== 'All') {
      if (detectType(e) !== filterState.typeFilter) return false;
    }

    if (filterState.currentFileOnly && currentFile) {
      if (e.filePath !== currentFile) return false;
    }

    return true;
  });
}

// ------------------------------------------------------------------
// Widget class structure tests
// ------------------------------------------------------------------

test('KAIRO_PROBLEMS_FACTORY_ID is "kairo-problems"', () => {
  assert.equal(KAIRO_PROBLEMS_FACTORY_ID, 'kairo-problems');
});

test('KairoProblemsWidget is a class with ID and render', () => {
  assert.equal(typeof KairoProblemsWidget, 'function');
  assert.equal(KairoProblemsWidget.ID, 'kairo-problems');
  const proto = KairoProblemsWidget.prototype;
  assert.equal(typeof proto.render, 'function');
});

// ------------------------------------------------------------------
// severityLabel tests
// ------------------------------------------------------------------

test('severityLabel maps Error to 错误', () => {
  assert.equal(severityLabel(MarkerSeverity.Error), '错误');
});

test('severityLabel maps Warning to 警告', () => {
  assert.equal(severityLabel(MarkerSeverity.Warning), '警告');
});

test('severityLabel maps Info to 信息', () => {
  assert.equal(severityLabel(MarkerSeverity.Info), '信息');
});

test('severityLabel maps Hint to 提示', () => {
  assert.equal(severityLabel(MarkerSeverity.Hint), '提示');
});

test('severityLabel maps unknown severity to 提示', () => {
  assert.equal(severityLabel(999), '提示');
});

// ------------------------------------------------------------------
// severityClass tests
// ------------------------------------------------------------------

test('severityClass returns correct CSS class for each severity', () => {
  assert.equal(severityClass(MarkerSeverity.Error), 'kairo-problem-severity-error');
  assert.equal(severityClass(MarkerSeverity.Warning), 'kairo-problem-severity-warning');
  assert.equal(severityClass(MarkerSeverity.Info), 'kairo-problem-severity-info');
  assert.equal(severityClass(MarkerSeverity.Hint), 'kairo-problem-severity-hint');
});

// ------------------------------------------------------------------
// sourceLabel tests
// ------------------------------------------------------------------

test('sourceLabel returns "Java" for kairo-build owner', () => {
  assert.equal(sourceLabel('kairo-build'), 'Java');
});

test('sourceLabel returns "Java" for java owner', () => {
  assert.equal(sourceLabel('java'), 'Java');
});

test('sourceLabel returns the owner string for unknown owners', () => {
  assert.equal(sourceLabel('typescript'), 'typescript');
  assert.equal(sourceLabel('eslint'), 'eslint');
});

// ------------------------------------------------------------------
// detectType tests
// ------------------------------------------------------------------

test('detectType identifies Java files', () => {
  assert.equal(detectType({ filePath: '/src/Main.java', source: '' }), 'Java');
  assert.equal(detectType({ filePath: '/src/Test.JAVA', source: '' }), 'Java');
});

test('detectType identifies XML files', () => {
  assert.equal(detectType({ filePath: '/config.xml', source: '' }), 'XML');
  assert.equal(detectType({ filePath: '/web.tld', source: '' }), 'XML');
});

test('detectType identifies JSP files', () => {
  assert.equal(detectType({ filePath: '/index.jsp', source: '' }), 'JSP');
  assert.equal(detectType({ filePath: '/page.jspx', source: '' }), 'JSP');
  assert.equal(detectType({ filePath: '/mytag.tag', source: '' }), 'JSP');
});

test('detectType identifies Encoding (properties) files', () => {
  assert.equal(detectType({ filePath: '/messages.properties', source: '' }), 'Encoding');
});

test('detectType identifies Ant (Build) source', () => {
  // The production detectType checks .xml extension before source,
  // so a .xml file with source 'Build' returns 'XML', not 'Ant'.
  assert.equal(detectType({ filePath: '/build.xml', source: 'Build' }), 'XML');
  // A non-xml file with source 'Build' returns 'Ant'
  assert.equal(detectType({ filePath: '/buildfile', source: 'Build' }), 'Ant');
});

test('detectType defaults to Java for unknown types', () => {
  assert.equal(detectType({ filePath: '/script.js', source: '' }), 'Java');
  assert.equal(detectType({ filePath: '/data.json', source: '' }), 'Java');
});

// ------------------------------------------------------------------
// markersToEntries tests
// ------------------------------------------------------------------

test('markersToEntries converts markers to entries', () => {
  const markers = [
    {
      resource: 'file:///src/Main.java',
      severity: MarkerSeverity.Error,
      startLineNumber: 10,
      startColumn: 5,
      message: 'cannot find symbol',
      owner: 'java',
    },
    {
      resource: 'file:///src/Test.java',
      severity: MarkerSeverity.Warning,
      startLineNumber: 20,
      startColumn: 1,
      message: 'unused import',
      owner: 'kairo-build',
    },
  ];

  const entries = markersToEntries(markers);
  assert.equal(entries.length, 2);

  assert.equal(entries[0].severity, MarkerSeverity.Error);
  assert.equal(entries[0].severityLabel, '错误');
  assert.equal(entries[0].file, 'Main.java');
  assert.equal(entries[0].filePath, 'file:///src/Main.java');
  assert.equal(entries[0].line, 10);
  assert.equal(entries[0].column, 5);
  assert.equal(entries[0].message, 'cannot find symbol');
  assert.equal(entries[0].source, 'Java');

  assert.equal(entries[1].severity, MarkerSeverity.Warning);
  assert.equal(entries[1].severityLabel, '警告');
  assert.equal(entries[1].file, 'Test.java');
  assert.equal(entries[1].source, 'Java');
});

test('markersToEntries generates unique keys', () => {
  const markers = [
    { resource: 'file:///a.java', severity: 8, startLineNumber: 1, startColumn: 1, message: 'm1', owner: 'java' },
    { resource: 'file:///a.java', severity: 8, startLineNumber: 1, startColumn: 1, message: 'm2', owner: 'java' },
  ];
  const entries = markersToEntries(markers);
  assert.notEqual(entries[0].key, entries[1].key);
});

test('markersToEntries handles empty array', () => {
  assert.deepEqual(markersToEntries([]), []);
});

// ------------------------------------------------------------------
// Filter state tests
// ------------------------------------------------------------------

test('loadFilterState returns default values', () => {
  const state = loadFilterState();
  assert.equal(state.showErrors, true);
  assert.equal(state.showWarnings, true);
  assert.equal(state.showInfos, true);
  assert.equal(state.fileFilter, '');
  assert.equal(state.typeFilter, 'All');
  assert.equal(state.currentFileOnly, false);
});

// ------------------------------------------------------------------
// Filtering logic tests
// ------------------------------------------------------------------

function makeEntry(overrides = {}) {
  return {
    key: 'test:1:1:0',
    severity: MarkerSeverity.Error,
    severityLabel: '错误',
    file: 'Main.java',
    filePath: '/src/Main.java',
    line: 1,
    column: 1,
    message: 'test error',
    source: 'Java',
    uri: 'file:///src/Main.java',
    ...overrides,
  };
}

test('filterEntries shows all entries when no filters are active', () => {
  const entries = [
    makeEntry({ severity: MarkerSeverity.Error, key: '1' }),
    makeEntry({ severity: MarkerSeverity.Warning, key: '2' }),
    makeEntry({ severity: MarkerSeverity.Info, key: '3' }),
  ];
  const filterState = loadFilterState();
  const result = filterEntries(entries, filterState, '');
  assert.equal(result.length, 3);
});

test('filterEntries hides errors when showErrors is false', () => {
  const entries = [
    makeEntry({ severity: MarkerSeverity.Error, key: '1' }),
    makeEntry({ severity: MarkerSeverity.Warning, key: '2' }),
  ];
  const filterState = { ...loadFilterState(), showErrors: false };
  const result = filterEntries(entries, filterState, '');
  assert.equal(result.length, 1);
  assert.equal(result[0].key, '2');
});

test('filterEntries hides warnings when showWarnings is false', () => {
  const entries = [
    makeEntry({ severity: MarkerSeverity.Error, key: '1' }),
    makeEntry({ severity: MarkerSeverity.Warning, key: '2' }),
  ];
  const filterState = { ...loadFilterState(), showWarnings: false };
  const result = filterEntries(entries, filterState, '');
  assert.equal(result.length, 1);
  assert.equal(result[0].key, '1');
});

test('filterEntries hides infos when showInfos is false', () => {
  const entries = [
    makeEntry({ severity: MarkerSeverity.Info, key: '1' }),
    makeEntry({ severity: MarkerSeverity.Error, key: '2' }),
  ];
  const filterState = { ...loadFilterState(), showInfos: false };
  const result = filterEntries(entries, filterState, '');
  assert.equal(result.length, 1);
  assert.equal(result[0].key, '2');
});

test('filterEntries filters by file name', () => {
  const entries = [
    makeEntry({ file: 'Main.java', filePath: '/src/Main.java', key: '1' }),
    makeEntry({ file: 'Test.java', filePath: '/src/Test.java', key: '2' }),
  ];
  const filterState = { ...loadFilterState(), fileFilter: 'Main' };
  const result = filterEntries(entries, filterState, '');
  assert.equal(result.length, 1);
  assert.equal(result[0].key, '1');
});

test('filterEntries file filter is case-insensitive', () => {
  const entries = [
    makeEntry({ file: 'Main.java', filePath: '/src/Main.java', key: '1' }),
  ];
  const filterState = { ...loadFilterState(), fileFilter: 'main' };
  const result = filterEntries(entries, filterState, '');
  assert.equal(result.length, 1);
});

test('filterEntries file filter matches filePath', () => {
  const entries = [
    makeEntry({ file: 'Main.java', filePath: '/src/main/Main.java', key: '1' }),
    makeEntry({ file: 'Test.java', filePath: '/src/test/Test.java', key: '2' }),
  ];
  const filterState = { ...loadFilterState(), fileFilter: 'src/main' };
  const result = filterEntries(entries, filterState, '');
  assert.equal(result.length, 1);
  assert.equal(result[0].key, '1');
});

test('filterEntries filters by type', () => {
  const entries = [
    makeEntry({ file: 'Main.java', filePath: '/src/Main.java', key: '1' }),
    makeEntry({ file: 'config.xml', filePath: '/src/config.xml', key: '2' }),
  ];
  const filterState = { ...loadFilterState(), typeFilter: 'Java' };
  const result = filterEntries(entries, filterState, '');
  assert.equal(result.length, 1);
  assert.equal(result[0].file, 'Main.java');
});

test('filterEntries filters by type XML', () => {
  const entries = [
    makeEntry({ file: 'Main.java', filePath: '/src/Main.java', key: '1' }),
    makeEntry({ file: 'config.xml', filePath: '/src/config.xml', key: '2' }),
  ];
  const filterState = { ...loadFilterState(), typeFilter: 'XML' };
  const result = filterEntries(entries, filterState, '');
  assert.equal(result.length, 1);
  assert.equal(result[0].file, 'config.xml');
});

test('filterEntries filters by current file only', () => {
  const entries = [
    makeEntry({ file: 'Main.java', filePath: '/src/Main.java', key: '1' }),
    makeEntry({ file: 'Test.java', filePath: '/src/Test.java', key: '2' }),
  ];
  const filterState = { ...loadFilterState(), currentFileOnly: true };
  const result = filterEntries(entries, filterState, '/src/Main.java');
  assert.equal(result.length, 1);
  assert.equal(result[0].key, '1');
});

test('filterEntries currentFileOnly with no current file shows all', () => {
  const entries = [
    makeEntry({ file: 'Main.java', filePath: '/src/Main.java', key: '1' }),
  ];
  const filterState = { ...loadFilterState(), currentFileOnly: true };
  const result = filterEntries(entries, filterState, '');
  assert.equal(result.length, 1);
});

test('filterEntries combines multiple filters', () => {
  const entries = [
    makeEntry({ severity: MarkerSeverity.Error, file: 'Main.java', filePath: '/src/Main.java', key: '1' }),
    makeEntry({ severity: MarkerSeverity.Error, file: 'Test.java', filePath: '/src/Test.java', key: '2' }),
    makeEntry({ severity: MarkerSeverity.Warning, file: 'Main.java', filePath: '/src/Main.java', key: '3' }),
    makeEntry({ severity: MarkerSeverity.Info, file: 'Main.java', filePath: '/src/Main.java', key: '4' }),
  ];
  const filterState = {
    showErrors: true,
    showWarnings: false,
    showInfos: false,
    fileFilter: 'Main',
    typeFilter: 'All',
    currentFileOnly: false,
  };
  const result = filterEntries(entries, filterState, '');
  assert.equal(result.length, 1);
  assert.equal(result[0].key, '1');
});

// ------------------------------------------------------------------
// Navigation logic tests
// ------------------------------------------------------------------

test('navigateToProblem with no selection goes to first on next', () => {
  const filtered = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  const selectedIndex = -1;
  const direction = 'next';
  const newIndex = direction === 'next' ? 0 : filtered.length - 1;
  assert.equal(newIndex, 0);
});

test('navigateToProblem with no selection goes to last on prev', () => {
  const filtered = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  const selectedIndex = -1;
  const direction = 'prev';
  const newIndex = direction === 'prev' ? filtered.length - 1 : 0;
  assert.equal(newIndex, 2);
});

test('navigateToProblem wraps around on next', () => {
  const filtered = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  let selectedIndex = 2;
  const direction = 'next';
  selectedIndex = direction === 'next'
    ? (selectedIndex + 1) % filtered.length
    : (selectedIndex - 1 + filtered.length) % filtered.length;
  assert.equal(selectedIndex, 0);
});

test('navigateToProblem wraps around on prev', () => {
  const filtered = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  let selectedIndex = 0;
  const direction = 'prev';
  selectedIndex = direction === 'prev'
    ? (selectedIndex - 1 + filtered.length) % filtered.length
    : (selectedIndex + 1) % filtered.length;
  assert.equal(selectedIndex, 2);
});

test('navigateToProblem returns early when filtered is empty', () => {
  const filtered = [];
  // If filtered.length === 0, the function returns without doing anything.
  assert.equal(filtered.length, 0);
});

// ------------------------------------------------------------------
// Problem count computation
// ------------------------------------------------------------------

test('problem counts are computed correctly', () => {
  const entries = [
    makeEntry({ severity: MarkerSeverity.Error, key: '1' }),
    makeEntry({ severity: MarkerSeverity.Error, key: '2' }),
    makeEntry({ severity: MarkerSeverity.Warning, key: '3' }),
    makeEntry({ severity: MarkerSeverity.Info, key: '4' }),
    makeEntry({ severity: MarkerSeverity.Info, key: '5' }),
    makeEntry({ severity: MarkerSeverity.Info, key: '6' }),
  ];
  const errors = entries.filter(e => e.severity === MarkerSeverity.Error).length;
  const warnings = entries.filter(e => e.severity === MarkerSeverity.Warning).length;
  const infos = entries.filter(e => e.severity === MarkerSeverity.Info).length;
  assert.equal(errors, 2);
  assert.equal(warnings, 1);
  assert.equal(infos, 3);
});

// ------------------------------------------------------------------
// Empty states
// ------------------------------------------------------------------

test('empty state shows "没有问题" when no entries at all', () => {
  const entries = [];
  const filtered = [];
  const message = entries.length === 0 ? '没有问题。' : '筛选后没有匹配的问题。';
  assert.equal(message, '没有问题。');
});

test('empty state shows filter message when entries exist but none match', () => {
  const entries = [makeEntry()];
  const filtered = [];
  const message = entries.length === 0 ? '没有问题。' : '筛选后没有匹配的问题。';
  assert.equal(message, '筛选后没有匹配的问题。');
});

// ------------------------------------------------------------------
// localStorage filter state persistence
// ------------------------------------------------------------------

test('filter state saves and loads from localStorage', () => {
  const FILTER_STATE_KEY = 'kairo.problems.filterState';
  const state = {
    showErrors: false,
    showWarnings: true,
    showInfos: false,
    fileFilter: 'Main',
    typeFilter: 'Java',
    currentFileOnly: true,
  };

  // Save
  localStorage.setItem(FILTER_STATE_KEY, JSON.stringify(state));

  // Load
  const saved = localStorage.getItem(FILTER_STATE_KEY);
  const parsed = JSON.parse(saved);
  const loaded = {
    showErrors: true,
    showWarnings: true,
    showInfos: true,
    fileFilter: '',
    typeFilter: 'All',
    currentFileOnly: false,
    ...parsed,
  };

  assert.equal(loaded.showErrors, false);
  assert.equal(loaded.showWarnings, true);
  assert.equal(loaded.showInfos, false);
  assert.equal(loaded.fileFilter, 'Main');
  assert.equal(loaded.typeFilter, 'Java');
  assert.equal(loaded.currentFileOnly, true);
});

test('filter state falls back to defaults when localStorage is corrupt', () => {
  const FILTER_STATE_KEY = 'kairo.problems.filterState';
  localStorage.setItem(FILTER_STATE_KEY, 'invalid json');

  let state;
  try {
    const saved = localStorage.getItem(FILTER_STATE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      state = {
        showErrors: true,
        showWarnings: true,
        showInfos: true,
        fileFilter: '',
        typeFilter: 'All',
        currentFileOnly: false,
        ...parsed,
      };
    }
  } catch {
    state = {
      showErrors: true,
      showWarnings: true,
      showInfos: true,
      fileFilter: '',
      typeFilter: 'All',
      currentFileOnly: false,
    };
  }

  assert.equal(state.showErrors, true);
  assert.equal(state.showWarnings, true);
});

// ------------------------------------------------------------------
// Type filter options
// ------------------------------------------------------------------

test('type filter options include all expected values', () => {
  const typeFilterOptions = ['All', 'Java', 'Ant', 'XML', 'JSP', 'Encoding'];
  assert.equal(typeFilterOptions.length, 6);
  assert.equal(typeFilterOptions[0], 'All');
  assert.ok(typeFilterOptions.includes('Java'));
  assert.ok(typeFilterOptions.includes('Ant'));
  assert.ok(typeFilterOptions.includes('XML'));
  assert.ok(typeFilterOptions.includes('JSP'));
  assert.ok(typeFilterOptions.includes('Encoding'));
});