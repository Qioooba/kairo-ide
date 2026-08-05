'use strict';

// CSS extension hook must be set up BEFORE any @theia/core module is loaded.
const Module = require('module');
Module._extensions['.css'] = function (module, filename) {
  module._compile('module.exports = {};', filename);
};

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

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

const {
  uriToFsPath,
  toRepoRelativePath,
  decodeGitQuotedPath,
  parsePorcelainStatusZ,
  parsePorcelainStatusLines,
  normalizeFsPath,
} = require('../../lib/browser/git-path-utils');

describe('git-path-utils — uriToFsPath / Windows file://', () => {
  it('strips file:// without leaving /G: on Windows-style URIs', () => {
    const p = uriToFsPath('file:///G:/spaces/kairo-ide/src/App.java');
    assert.ok(!p.startsWith('/G:'), `unexpected leading slash: ${p}`);
    assert.match(p, /^G:\//i);
    assert.ok(p.toLowerCase().endsWith('/src/app.java'));
  });

  it('handles file:///g%3A/ encoded drive', () => {
    const p = uriToFsPath('file:///g%3A/foo/bar.txt');
    assert.ok(!p.startsWith('/g:'), `unexpected leading slash: ${p}`);
    assert.match(p, /^g:\//i);
  });

  it('passes through bare paths with forward slashes', () => {
    assert.strictEqual(uriToFsPath('G:\\foo\\bar'), 'G:/foo/bar');
    assert.strictEqual(uriToFsPath('/home/user/repo'), '/home/user/repo');
  });

  it('normalizeFsPath strips trailing slashes', () => {
    assert.strictEqual(normalizeFsPath('G:\\repo\\'), 'G:/repo');
  });
});

describe('git-path-utils — toRepoRelativePath', () => {
  it('computes relative path on Windows URIs', () => {
    const rel = toRepoRelativePath(
      'file:///G:/spaces/repo/src/Main.java',
      'G:/spaces/repo',
    );
    assert.strictEqual(rel, 'src/Main.java');
  });

  it('is case-insensitive for drive/root matching', () => {
    const rel = toRepoRelativePath(
      'file:///g:/Spaces/Repo/a.txt',
      'G:/spaces/repo',
    );
    assert.strictEqual(rel, 'a.txt');
  });

  it('returns undefined outside the repo', () => {
    assert.strictEqual(
      toRepoRelativePath('file:///G:/other/file.txt', 'G:/spaces/repo'),
      undefined,
    );
  });

  it('accepts already-relative paths', () => {
    assert.strictEqual(toRepoRelativePath('src/a.ts', 'G:/repo'), 'src/a.ts');
  });
});

describe('git-path-utils — decodeGitQuotedPath (quotepath)', () => {
  it('decodes UTF-8 octal escapes for Chinese filenames', () => {
    // 文件.txt in UTF-8: E6 96 87 E4 BB B6
    const quoted = '"\\346\\226\\207\\344\\273\\266.txt"';
    assert.strictEqual(decodeGitQuotedPath(quoted), '文件.txt');
  });

  it('decodes paths with spaces', () => {
    assert.strictEqual(decodeGitQuotedPath('"my file.txt"'), 'my file.txt');
  });

  it('passes through unquoted paths', () => {
    assert.strictEqual(decodeGitQuotedPath('plain.txt'), 'plain.txt');
  });

  it('handles escaped quotes and backslashes', () => {
    assert.strictEqual(decodeGitQuotedPath('"a\\\\b\\"c"'), 'a\\b"c');
  });
});

describe('git-path-utils — parsePorcelainStatusLines', () => {
  it('decodes quoted Chinese paths in classic porcelain', () => {
    const stdout = [
      '## main',
      ' M "\\346\\226\\207\\344\\273\\266.txt"',
      '?? "my file.txt"',
    ].join('\n');
    const parsed = parsePorcelainStatusLines(stdout);
    assert.strictEqual(parsed.branch, 'main');
    assert.strictEqual(parsed.files.length, 2);
    assert.strictEqual(parsed.files[0].path, '文件.txt');
    assert.strictEqual(parsed.files[0].status, 'M');
    assert.strictEqual(parsed.files[0].staged, false);
    assert.strictEqual(parsed.files[1].path, 'my file.txt');
    assert.strictEqual(parsed.files[1].status, '?');
  });

  it('decodes rename with quoted paths', () => {
    const stdout = 'R  "old\\040name.txt" -> "\\346\\226\\207.txt"';
    const parsed = parsePorcelainStatusLines(stdout);
    assert.strictEqual(parsed.files.length, 1);
    assert.strictEqual(parsed.files[0].origPath, 'old name.txt');
    assert.strictEqual(parsed.files[0].path, '文.txt');
    assert.ok(parsed.files[0].status.includes('R'));
  });
});

describe('git-path-utils — parsePorcelainStatusZ', () => {
  it('parses NUL-separated entries including renames', () => {
    const stdout = [
      '## main...origin/main [ahead 1, behind 2]',
      'M  src/a.ts',
      'R  old.ts',
      'new.ts',
      '?? untracked.txt',
      '',
    ].join('\0');
    const parsed = parsePorcelainStatusZ(stdout);
    assert.strictEqual(parsed.branch, 'main');
    assert.strictEqual(parsed.ahead, 1);
    assert.strictEqual(parsed.behind, 2);
    assert.strictEqual(parsed.files.length, 3);
    assert.strictEqual(parsed.files[0].path, 'src/a.ts');
    assert.strictEqual(parsed.files[0].staged, true);
    assert.strictEqual(parsed.files[1].origPath, 'old.ts');
    assert.strictEqual(parsed.files[1].path, 'new.ts');
    assert.strictEqual(parsed.files[2].path, 'untracked.txt');
    assert.strictEqual(parsed.files[2].status, '?');
  });
});

describe('teardown', () => {
  it('cleanup', () => {
    disableJSDOM();
  });
});
