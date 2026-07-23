'use strict';
const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom'); enableJSDOM();
if (!global.DragEvent) global.DragEvent = class DragEvent extends global.MouseEvent {};
const Module = require('module'); Module._extensions['.css'] = (module, filename) => module._compile('module.exports = {};', filename);
const { FrontendApplicationConfigProvider } = require('@theia/core/lib/browser/frontend-application-config-provider'); FrontendApplicationConfigProvider.set({ defaultTheme: 'dark', defaultIconTheme: 'theia-file-icons', applicationName: 'Kairo', validatePreferencesSchema: true });
const { test } = require('node:test'); const assert = require('node:assert');
const { SearchReplaceService, locateEdits, applyEdits, fingerprint } = require('../../lib/browser/search-replace-service');

function match(file, line, column, text) { return { file, line, column, matchText: text, contextBefore: '', contextAfter: '' }; }

test('creates deterministic edits and applies selected replacements without writing', () => {
  const content = 'hello world\nhello again\n';
  const edits = locateEdits(content, [match('A.java', 1, 1, 'hello'), match('A.java', 2, 1, 'hello')], 'hi');
  edits[1].selected = false;
  assert.strictEqual(applyEdits(content, edits.filter(edit => edit.selected)), 'hello world\nhi again\n');
  assert.strictEqual(fingerprint(content), fingerprint(content));
});

test('handles rune-based columns and rejects drift and overlap', () => {
  const content = '你a target\n';
  const edits = locateEdits(content, [match('A.java', 1, 4, 'target')], 'done');
  assert.strictEqual(applyEdits(content, edits), '你a done\n');
  assert.throws(() => locateEdits(content, [match('A.java', 1, 4, 'wrong')], 'x'), /drift/);
  assert.throws(() => locateEdits('aaaa', [match('A', 1, 1, 'aaa'), match('A', 1, 2, 'aaa')], 'x'), /Overlapping/);
});

test('apply rejects a drifted file and never writes it', async () => {
  const service = new SearchReplaceService(); let writes = 0;
  service.workspace = { requireContext: () => ({ workspaceRoot: '/workspace' }) };
  service.files = { read: async () => ({ value: 'changed', encoding: 'utf8', mtime: 2, etag: 'new' }), write: async () => { writes++; } };
  const result = await service.apply({ replacement: 'x', files: [{ file: 'A.java', fingerprint: fingerprint('original'), encoding: 'utf8', mtime: 1, etag: 'old', original: 'original', preview: 'x', edits: [{ id: '1', line: 1, column: 1, before: 'original', after: 'x', selected: true }] }] });
  assert.strictEqual(result[0].status, 'failed'); assert.match(result[0].error, /changed after preview/); assert.strictEqual(writes, 0);
});

function filePlan(file, original, after) { return { file, fingerprint: fingerprint(original), encoding: 'utf8', mtime: 1, etag: `${file}-1`, original, preview: after, edits: [{ id: file, line: 1, column: 1, before: original, after, selected: true }] }; }

test('preflight failure across multiple files performs zero writes', async () => {
  const service = new SearchReplaceService(); let writes = 0;
  service.workspace = { requireContext: () => ({ workspaceRoot: '/workspace' }) };
  service.files = { read: async uri => ({ value: uri.toString().includes('B.java') ? 'drift' : 'a', encoding: 'utf8', mtime: 1, etag: uri.toString().includes('B.java') ? 'B-2' : 'A.java-1' }), write: async () => { writes++; } };
  const results = await service.apply({ replacement: 'x', files: [filePlan('A.java', 'a', 'x'), filePlan('B.java', 'b', 'x')] });
  assert.strictEqual(writes, 0); assert.ok(results.some(result => result.status === 'failed'));
});

test('write failure compensates already written files in reverse', async () => {
  const service = new SearchReplaceService(); const disk = { 'A.java': { value: 'a', mtime: 1, etag: 'A.java-1' }, 'B.java': { value: 'b', mtime: 1, etag: 'B.java-1' } }; const writes = [];
  service.workspace = { requireContext: () => ({ workspaceRoot: '/workspace' }) };
  service.files = {
    read: async uri => ({ ...disk[uri.path.base], encoding: 'utf8' }),
    write: async (uri, value) => { const file = uri.path.base; writes.push(`${file}:${value}`); if (file === 'B.java') throw new Error('locked'); disk[file] = { value, mtime: 2, etag: `${file}-2` }; return { ...disk[file] }; },
  };
  const results = await service.apply({ replacement: 'x', files: [filePlan('A.java', 'a', 'x'), filePlan('B.java', 'b', 'x')] });
  assert.deepStrictEqual(writes, ['A.java:x', 'B.java:x', 'A.java:a']); assert.strictEqual(disk['A.java'].value, 'a'); assert.ok(results.some(result => result.status === 'rolled-back'));
});

test('undo succeeds only while every applied post-image is unchanged', async () => {
  const service = new SearchReplaceService(); const disk = { value: 'a', mtime: 1, etag: 'A.java-1' }; let revision = 1;
  service.workspace = { requireContext: () => ({ workspaceRoot: '/workspace' }) };
  service.files = { read: async () => ({ ...disk, encoding: 'utf8' }), write: async (_uri, value) => { revision++; Object.assign(disk, { value, mtime: revision, etag: `A.java-${revision}` }); return { ...disk }; } };
  await service.apply({ replacement: 'x', files: [filePlan('A.java', 'a', 'x')] });
  let result = await service.undoLastApply(); assert.strictEqual(result[0].status, 'undone'); assert.strictEqual(disk.value, 'a');
  await service.apply({ replacement: 'x', files: [{ ...filePlan('A.java', 'a', 'x'), mtime: disk.mtime, etag: disk.etag }] });
  disk.value = 'user edit';
  result = await service.undoLastApply(); assert.strictEqual(result[0].status, 'failed'); assert.strictEqual(disk.value, 'user edit');
});

test('a write that persists then throws is detected and rolled back', async () => {
  const service = new SearchReplaceService(); const disk = { 'A.java': { value: 'a', mtime: 1, etag: 'A.java-1' }, 'B.java': { value: 'b', mtime: 1, etag: 'B.java-1' } };
  service.workspace = { requireContext: () => ({ workspaceRoot: '/workspace' }) };
  service.files = {
    read: async uri => ({ ...disk[uri.path.base], encoding: 'utf8' }),
    write: async (uri, value) => { const file = uri.path.base; const revision = disk[file].mtime + 1; disk[file] = { value, mtime: revision, etag: `${file}-${revision}` }; if (file === 'B.java' && value === 'x') throw new Error('late fsync error'); return { ...disk[file] }; },
  };
  const results = await service.apply({ replacement: 'x', files: [filePlan('A.java', 'a', 'x'), filePlan('B.java', 'b', 'x')] });
  assert.strictEqual(disk['A.java'].value, 'a'); assert.strictEqual(disk['B.java'].value, 'b');
  assert.strictEqual(results.filter(result => result.status === 'rolled-back').length, 2);
});

test('undo write failure compensates already undone files back to applied content', async () => {
  const service = new SearchReplaceService(); const disk = { 'A.java': { value: 'a', mtime: 1, etag: 'A.java-1' }, 'B.java': { value: 'b', mtime: 1, etag: 'B.java-1' } }; let undoPhase = false;
  service.workspace = { requireContext: () => ({ workspaceRoot: '/workspace' }) };
  service.files = {
    read: async uri => ({ ...disk[uri.path.base], encoding: 'utf8' }),
    write: async (uri, value) => { const file = uri.path.base; if (undoPhase && file === 'B.java' && value === 'b') throw new Error('undo locked'); const revision = disk[file].mtime + 1; disk[file] = { value, mtime: revision, etag: `${file}-${revision}` }; return { ...disk[file] }; },
  };
  await service.apply({ replacement: 'x', files: [filePlan('A.java', 'a', 'x'), filePlan('B.java', 'b', 'x')] }); undoPhase = true;
  const results = await service.undoLastApply();
  assert.strictEqual(disk['A.java'].value, 'x'); assert.strictEqual(disk['B.java'].value, 'x');
  assert.ok(results.some(result => result.status === 'undo-rolled-back'));
});
