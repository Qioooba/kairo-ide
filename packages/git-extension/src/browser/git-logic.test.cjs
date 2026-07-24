'use strict';

// CSS extension hook must be set up BEFORE any @theia/core module is loaded.
const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Set up JSDOM for localStorage support
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

const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider');
FrontendApplicationConfigProvider.set({
  defaultTheme: 'dark',
  defaultIconTheme: 'theia-file-icons',
  applicationName: 'Kairo',
  validatePreferencesSchema: true,
});

require('reflect-metadata');

// Load compiled modules
const { GitCommitTemplateService } = require('../../lib/browser/git-commit-template');
const { GitCommitSearch } = require('../../lib/browser/git-commit-search');
const { GitService } = require('../../lib/browser/git-service');
const { GitStore } = require('../../lib/browser/git-store');

// ============================================================================
// GitCommitTemplateService tests
// ============================================================================

describe('GitCommitTemplateService — Templates', () => {
  let svc;

  beforeEach(() => {
    localStorage.clear();
    svc = new GitCommitTemplateService();
    svc.gitService = {
      getRepoRoot: () => undefined,
      getStatus: () => Promise.resolve({ branch: 'master', files: [], ahead: 0, behind: 0 }),
    };
  });

  it('provides default templates', () => {
    const templates = svc.getTemplates();
    assert.ok(templates.length >= 7);
    assert.strictEqual(templates[0].name, '默认');
    assert.strictEqual(templates[1].name, 'feat');
    assert.strictEqual(templates[2].name, 'fix');
  });

  it('selects template by index', () => {
    svc.selectTemplate(1);
    const selected = svc.getSelectedTemplate();
    assert.strictEqual(selected.name, 'feat');
  });

  it('ignores out-of-range template index', () => {
    svc.selectTemplate(0);
    svc.selectTemplate(999);
    const selected = svc.getSelectedTemplate();
    assert.strictEqual(selected.name, '默认');
  });

  it('ignores negative template index', () => {
    svc.selectTemplate(-1);
    const selected = svc.getSelectedTemplate();
    assert.strictEqual(selected.name, '默认');
  });

  it('custom template get/set', () => {
    svc.setCustomTemplate('custom: {module} - {branch}');
    assert.strictEqual(svc.getCustomTemplate(), 'custom: {module} - {branch}');
  });

  it('generates message with default template', async () => {
    const msg = await svc.generateMessage('default', 'module-a', 'fix bug');
    assert.strictEqual(msg, '[module-a] fix bug');
  });

  it('generates message with feat template', async () => {
    const msg = await svc.generateMessage('feat', 'module-a', 'add feature');
    assert.strictEqual(msg, 'feat(module-a): add feature');
  });

  it('generates message with fix template', async () => {
    const msg = await svc.generateMessage('fix', 'module-a', 'fix crash');
    assert.strictEqual(msg, 'fix(module-a): fix crash');
  });

  it('generates message with refactor template', async () => {
    const msg = await svc.generateMessage('refactor', 'module-a', 'clean up');
    assert.strictEqual(msg, 'refactor(module-a): clean up');
  });

  it('falls back to default module when empty', async () => {
    svc.gitService = {
      getRepoRoot: () => '/repo',
      getStatus: () => Promise.resolve({ branch: 'feature/my-feature', files: [], ahead: 0, behind: 0 }),
    };
    const msg = await svc.generateMessage('feat', '', 'add feature');
    // branch "feature/my-feature" split by / or - => parts[1] = "my"
    assert.strictEqual(msg, 'feat(my): add feature');
  });

  it('detects module from branch name with slash', async () => {
    svc.gitService = {
      getRepoRoot: () => '/repo',
      getStatus: () => Promise.resolve({ branch: 'feature/user-module', files: [], ahead: 0, behind: 0 }),
    };
    const msg = await svc.generateMessage('feat', '', 'add feature');
    assert.strictEqual(msg, 'feat(user): add feature');
  });

  it('detects module from branch with hyphen', async () => {
    svc.gitService = {
      getRepoRoot: () => '/repo',
      getStatus: () => Promise.resolve({ branch: 'hotfix-login-fix', files: [], ahead: 0, behind: 0 }),
    };
    const msg = await svc.generateMessage('feat', '', 'fix login');
    assert.strictEqual(msg, 'feat(login): fix login');
  });

  it('uses branch name as module when no separator', async () => {
    svc.gitService = {
      getRepoRoot: () => '/repo',
      getStatus: () => Promise.resolve({ branch: 'main', files: [], ahead: 0, behind: 0 }),
    };
    const msg = await svc.generateMessage('feat', '', 'update');
    assert.strictEqual(msg, 'feat(main): update');
  });
});

describe('GitCommitTemplateService — Message Stats', () => {
  let svc;

  beforeEach(() => {
    localStorage.clear();
    svc = new GitCommitTemplateService();
    svc.gitService = {
      getRepoRoot: () => undefined,
      getStatus: () => Promise.resolve({ branch: 'master', files: [], ahead: 0, behind: 0 }),
    };
  });

  it('counts characters in message', () => {
    const stats = svc.getMessageStats('hello');
    assert.strictEqual(stats.charCount, 5);
    assert.strictEqual(stats.bodyLines.length, 0);
  });

  it('reports body lines that exceed 72 chars', () => {
    const msg = 'subject\n' + 'A'.repeat(73);
    const stats = svc.getMessageStats(msg);
    assert.strictEqual(stats.bodyLines.length, 1);
    assert.strictEqual(stats.bodyLines[0].line, 2);
    assert.strictEqual(stats.bodyLines[0].length, 73);
    assert.strictEqual(stats.bodyLines[0].exceedsLimit, true);
  });

  it('reports body lines within limit', () => {
    const msg = 'subject\n' + 'A'.repeat(72);
    const stats = svc.getMessageStats(msg);
    assert.strictEqual(stats.bodyLines.length, 1);
    assert.strictEqual(stats.bodyLines[0].exceedsLimit, false);
  });

  it('detects body line warnings', () => {
    const msg = 'subject\n' + 'A'.repeat(73);
    assert.strictEqual(svc.hasBodyLineWarnings(msg), true);
  });

  it('no warnings for within-limit message', () => {
    const msg = 'subject\nshort line';
    assert.strictEqual(svc.hasBodyLineWarnings(msg), false);
  });

  it('returns warning messages for long lines', () => {
    const msg = 'subject\n' + 'A'.repeat(73);
    const warnings = svc.getBodyLineWarnings(msg);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('第 2 行'));
    assert.ok(warnings[0].includes('73'));
    assert.ok(warnings[0].includes('72'));
  });

  it('handles empty message', () => {
    const stats = svc.getMessageStats('');
    assert.strictEqual(stats.charCount, 0);
    assert.strictEqual(stats.bodyLines.length, 0);
    assert.strictEqual(svc.hasBodyLineWarnings(''), false);
  });

  it('handles multi-line message with mixed line lengths', () => {
    const msg = 'subject\n' + 'A'.repeat(50) + '\n' + 'B'.repeat(80) + '\n' + 'C'.repeat(72);
    const stats = svc.getMessageStats(msg);
    assert.strictEqual(stats.bodyLines.length, 3);
    assert.strictEqual(stats.bodyLines[0].exceedsLimit, false);
    assert.strictEqual(stats.bodyLines[1].exceedsLimit, true);
    assert.strictEqual(stats.bodyLines[2].exceedsLimit, false);
    assert.strictEqual(svc.hasBodyLineWarnings(msg), true);
  });
});

describe('GitCommitTemplateService — Recent Commits', () => {
  let svc;

  beforeEach(() => {
    localStorage.clear();
    svc = new GitCommitTemplateService();
    svc.gitService = {
      getRepoRoot: () => '/repo',
      getStatus: () => Promise.resolve({ branch: 'master', files: [], ahead: 0, behind: 0 }),
      getHistory: () => Promise.resolve([
        { hash: 'abc', author: 'dev', email: 'a@b.com', date: new Date(), message: 'fix: crash' },
        { hash: 'def', author: 'dev2', email: 'c@d.com', date: new Date(), message: 'feat: login' },
      ]),
    };
  });

  it('returns empty suggestions initially', () => {
    assert.deepStrictEqual(svc.getRecentSuggestions(), []);
  });

  it('loads recent commits from history', async () => {
    const suggestions = await svc.loadRecentCommits();
    assert.ok(suggestions.length >= 2);
    assert.strictEqual(suggestions[0].message, 'fix: crash');
    assert.strictEqual(suggestions[1].message, 'feat: login');
  });

  it('records a commit and shows it first', async () => {
    await svc.loadRecentCommits();
    svc.recordCommit('new: feature');
    const suggestions = svc.getRecentSuggestions();
    assert.strictEqual(suggestions[0].message, 'new: feature');
    assert.strictEqual(suggestions[0].source, 'recent');
  });

  it('deduplicates recorded commits', async () => {
    await svc.loadRecentCommits();
    svc.recordCommit('fix: crash');
    svc.recordCommit('fix: crash');
    const suggestions = svc.getRecentSuggestions();
    const count = suggestions.filter(s => s.message === 'fix: crash').length;
    assert.strictEqual(count, 1);
  });
});

describe('GitCommitTemplateService — Preferences', () => {
  let svc;

  beforeEach(() => {
    localStorage.clear();
    svc = new GitCommitTemplateService();
    svc.gitService = {
      getRepoRoot: () => undefined,
      getStatus: () => Promise.resolve({ branch: 'master', files: [], ahead: 0, behind: 0 }),
    };
  });

  it('loads persisted template preferences', () => {
    localStorage.setItem('kairo-git-commit-template-prefs', JSON.stringify({
      selectedTemplateIndex: 2,
      customTemplate: 'custom: {description}',
    }));
    svc.loadTemplatePreferences();
    assert.strictEqual(svc.getSelectedTemplate().name, 'fix');
    assert.strictEqual(svc.getCustomTemplate(), 'custom: {description}');
  });

  it('handles corrupt localStorage gracefully', () => {
    localStorage.setItem('kairo-git-commit-template-prefs', 'not-json');
    svc.loadTemplatePreferences();
    assert.strictEqual(svc.getSelectedTemplate().name, '默认');
  });

  it('handles missing localStorage gracefully', () => {
    svc.loadTemplatePreferences();
    assert.strictEqual(svc.getSelectedTemplate().name, '默认');
  });
});

// ============================================================================
// GitCommitSearch tests
// ============================================================================

describe('GitCommitSearch — Summary Management', () => {
  let search;

  beforeEach(() => {
    search = new GitCommitSearch();
    search.gitService = {
      getRepoRoot: () => '/repo',
    };
  });

  it('starts with idle summary', () => {
    const summary = search.getSummary();
    assert.strictEqual(summary.status, 'idle');
    assert.strictEqual(summary.results.length, 0);
    assert.strictEqual(summary.query, '');
    assert.strictEqual(summary.totalCount, 0);
  });

  it('reset clears to idle', () => {
    search.reset();
    const summary = search.getSummary();
    assert.strictEqual(summary.status, 'idle');
    assert.strictEqual(summary.results.length, 0);
  });

  it('cancel during idle is safe', () => {
    search.cancel();
    const summary = search.getSummary();
    assert.strictEqual(summary.status, 'idle');
  });

  it('getSummary returns a copy', () => {
    const s1 = search.getSummary();
    const s2 = search.getSummary();
    assert.notStrictEqual(s1, s2);
    assert.notStrictEqual(s1.results, s2.results);
  });
});

describe('GitCommitSearch — search with empty repo', () => {
  let search;

  beforeEach(() => {
    search = new GitCommitSearch();
    search.gitService = {
      getRepoRoot: () => undefined,
    };
  });

  it('returns empty results when no repo root', async () => {
    const summary = await search.search({});
    assert.strictEqual(summary.status, 'completed');
    assert.strictEqual(summary.totalCount, 0);
  });
});

// ============================================================================
// GitService tests
// ============================================================================

describe('GitService — Basic Operations', () => {
  let svc;

  beforeEach(() => {
    svc = new GitService();
  });

  it('starts with undefined repo root', () => {
    assert.strictEqual(svc.getRepoRoot(), undefined);
  });

  it('setRepoRoot and getRepoRoot', () => {
    svc.setRepoRoot('/test/repo');
    assert.strictEqual(svc.getRepoRoot(), '/test/repo');
  });

  it('getFileStatus returns undefined when no cached status', () => {
    assert.strictEqual(svc.getFileStatus('file.txt'), undefined);
  });

  it('getFileStatus finds file in cached status', () => {
    svc.setRepoRoot('/repo');
    svc.cachedStatus = {
      branch: 'main',
      files: [
        { path: 'src/a.ts', status: 'M', staged: false },
        { path: 'src/b.ts', status: 'A', staged: true },
      ],
      ahead: 0,
      behind: 0,
    };
    const status = svc.getFileStatus('src/a.ts');
    assert.ok(status);
    assert.strictEqual(status.path, 'src/a.ts');
    assert.strictEqual(status.status, 'M');
    assert.strictEqual(status.staged, false);
  });

  it('getFileStatus returns undefined for unknown file', () => {
    svc.setRepoRoot('/repo');
    svc.cachedStatus = {
      branch: 'main',
      files: [{ path: 'src/a.ts', status: 'M', staged: false }],
      ahead: 0,
      behind: 0,
    };
    assert.strictEqual(svc.getFileStatus('unknown.ts'), undefined);
  });
});

// ============================================================================
// GitStore tests
// ============================================================================

describe('GitStore — State Management', () => {
  let store;

  beforeEach(() => {
    store = new GitStore();
    store.gitService = {
      onDidChange: () => {},
      getStatus: () => Promise.resolve({
        branch: 'main',
        files: [
          { path: 'src/a.ts', status: 'M', staged: false },
          { path: 'src/b.ts', status: 'A', staged: true },
        ],
        ahead: 0,
        behind: 0,
      }),
      stageFiles: () => Promise.resolve(),
      unstageFiles: () => Promise.resolve(),
      stageAll: () => Promise.resolve(),
      unstageAll: () => Promise.resolve(),
      commit: () => Promise.resolve({ hash: 'abc', message: 'test', filesChanged: 1 }),
    };
  });

  it('returns initial state', () => {
    const state = store.getState();
    assert.strictEqual(state.branch, '');
    assert.strictEqual(state.stagedChanges.length, 0);
    assert.strictEqual(state.unstagedChanges.length, 0);
    assert.strictEqual(state.loading, false);
  });

  it('refresh populates state', async () => {
    await store.refresh();
    const state = store.getState();
    assert.strictEqual(state.branch, 'main');
    assert.strictEqual(state.stagedChanges.length, 1);
    assert.strictEqual(state.unstagedChanges.length, 1);
    assert.strictEqual(state.stagedChanges[0].path, 'src/b.ts');
    assert.strictEqual(state.unstagedChanges[0].path, 'src/a.ts');
    assert.strictEqual(state.loading, false);
  });

  it('stages files and refreshes', async () => {
    await store.stageFiles(['src/c.ts']);
    const state = store.getState();
    assert.strictEqual(state.branch, 'main');
    assert.strictEqual(state.loading, false);
  });

  it('unstages files and refreshes', async () => {
    await store.unstageFiles(['src/a.ts']);
    const state = store.getState();
    assert.strictEqual(state.branch, 'main');
  });

  it('stageAll works', async () => {
    await store.stageAll();
    const state = store.getState();
    assert.strictEqual(state.branch, 'main');
  });

  it('unstageAll works', async () => {
    await store.unstageAll();
    const state = store.getState();
    assert.strictEqual(state.branch, 'main');
  });

  it('handles refresh error', async () => {
    store.gitService.getStatus = () => Promise.reject(new Error('git not found'));
    await store.refresh();
    const state = store.getState();
    assert.strictEqual(state.loading, false);
    assert.strictEqual(state.error, 'git not found');
  });

  it('handles stageFiles error', async () => {
    store.gitService.stageFiles = () => Promise.reject(new Error('permission denied'));
    await store.stageFiles(['file.ts']);
    const state = store.getState();
    assert.strictEqual(state.error, 'permission denied');
  });

  it('handles non-Error throws in stageFiles', async () => {
    store.gitService.stageFiles = () => Promise.reject('string error');
    await store.stageFiles(['file.ts']);
    const state = store.getState();
    assert.strictEqual(state.error, 'string error');
  });

  it('commit populates branch', async () => {
    const result = await store.commit('test commit');
    assert.strictEqual(result.hash, 'abc');
    assert.strictEqual(result.message, 'test');
    const state = store.getState();
    assert.strictEqual(state.branch, 'main');
  });

  it('handles commit error', async () => {
    store.gitService.commit = () => Promise.reject(new Error('no changes'));
    try {
      await store.commit('empty');
    } catch {
      // expected
    }
    const state = store.getState();
    assert.strictEqual(state.error, 'no changes');
  });

  it('requestDiff fires diff request event', (_, done) => {
    store.onDiffRequest(evt => {
      assert.strictEqual(evt.file, 'src/a.ts');
      assert.strictEqual(evt.staged, true);
      done();
    });
    store.requestDiff('src/a.ts', true);
  });
});

describe('GitStore — getState returns copy', () => {
  it('getState returns a new object each time', () => {
    const store = new GitStore();
    store.gitService = {
      onDidChange: () => {},
      getStatus: () => Promise.resolve({ branch: 'main', files: [], ahead: 0, behind: 0 }),
    };
    const s1 = store.getState();
    const s2 = store.getState();
    assert.notStrictEqual(s1, s2);
  });
});

// ============================================================================
// Cleanup
// ============================================================================

describe('teardown', () => {
  it('cleanup', () => {
    disableJSDOM();
  });
});