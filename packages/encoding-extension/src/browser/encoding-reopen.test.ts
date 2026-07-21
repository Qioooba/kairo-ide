// Regression tests for the "Reopen with Encoding" reload strategy
// and the hierarchy-correct EncodingRegistry (KAIRO-RC-WEB-206).
//
// Background: the reopen command used to close the editor and
// re-open it through EditorManager. The Monaco model reference was
// still alive at re-open time, so the editor came back over the
// SAME cached UTF-8-decoded model — the file was never re-decoded
// and a later save wrote the mojibake back as UTF-8 bytes,
// silently corrupting GBK files. The strategy now prefers Theia's
// native editor.setEncoding(picked, EncodingMode.Decode) on the
// live editor, which re-reads the file in place.
//
// Run with:
//   pnpm --filter @kairo/encoding-extension test

import { test } from 'node:test';
import assert from 'node:assert';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import {
  reloadEditorWithEncoding,
  ENCODING_MODE_DECODE,
  EditorWidgetLike,
} from './reopen-strategy';
import { KairoEncodingRegistry } from './kairo-encoding-registry';

function makeWidget(editor: { setEncoding?: (e: string, m: number) => Promise<void>; document: { dirty: boolean } }) {
  const widget: EditorWidgetLike & { closed: boolean } = {
    editor,
    closed: false,
    close() {
      (widget as { closed: boolean }).closed = true;
      for (const cb of disposeListeners) cb();
    },
    onDidDispose(cb: () => void) {
      disposeListeners.push(cb);
    },
  };
  const disposeListeners: (() => void)[] = [];
  return widget;
}

function makeHarness(widget: ReturnType<typeof makeWidget>) {
  const opened: unknown[] = [];
  const warns: string[] = [];
  const editorManager = { open: async (uri: unknown) => { opened.push(uri); } };
  const messages = { warn: (m: string) => { warns.push(m); } };
  return { opened, warns, editorManager, messages };
}

test('reload prefers live-editor setEncoding(Decode), no close/reopen', async () => {
  const calls: { encoding: string; mode: number }[] = [];
  const widget = makeWidget({
    document: { dirty: false },
    setEncoding: async (encoding, mode) => { calls.push({ encoding, mode }); },
  });
  const h = makeHarness(widget);
  const uri = FileUri.create('/p/WebRoot/hello.jsp');

  const outcome = await reloadEditorWithEncoding(widget, uri, 'gbk', h.editorManager, h.messages);

  assert.strictEqual(outcome, 'redecoded');
  assert.deepStrictEqual(calls, [{ encoding: 'gbk', mode: ENCODING_MODE_DECODE }],
    'live editor must re-decode via setEncoding(picked, Decode)');
  assert.strictEqual(widget.closed, false, 'widget must NOT be closed on the native path');
  assert.deepStrictEqual(h.opened, [], 'EditorManager.open must NOT be called on the native path');
});

test('reload refuses on a dirty document instead of discarding edits', async () => {
  const calls: { encoding: string; mode: number }[] = [];
  const widget = makeWidget({
    document: { dirty: true },
    setEncoding: async (encoding, mode) => { calls.push({ encoding, mode }); },
  });
  const h = makeHarness(widget);

  const outcome = await reloadEditorWithEncoding(widget, FileUri.create('/p/a.jsp'), 'gbk', h.editorManager, h.messages);

  assert.strictEqual(outcome, 'refused-dirty');
  assert.deepStrictEqual(calls, [], 'dirty model must not be re-decoded');
  assert.strictEqual(widget.closed, false, 'dirty widget must not be closed');
  assert.deepStrictEqual(h.opened, []);
  assert.strictEqual(h.warns.length, 1, 'user warned about dirty file');
});

test('reload falls back to close/reopen when the editor lacks setEncoding', async () => {
  const widget = makeWidget({ document: { dirty: false } });
  const h = makeHarness(widget);
  const uri = FileUri.create('/p/WebRoot/hello.jsp');

  const outcome = await reloadEditorWithEncoding(widget, uri, 'gbk', h.editorManager, h.messages);

  assert.strictEqual(outcome, 'reopened');
  assert.strictEqual(widget.closed, true, 'widget closed on fallback path');
  assert.deepStrictEqual(h.opened, [uri], 'editor re-opened after disposal');
});

test('KairoEncodingRegistry: folder override matches files beneath it', () => {
  const reg = new KairoEncodingRegistry();
  reg.registerOverride({ parent: FileUri.create('/proj'), encoding: 'gbk' });
  const getOverride = (reg as unknown as { getEncodingOverride(u: URI): string | undefined }).getEncodingOverride.bind(reg);
  assert.strictEqual(getOverride(FileUri.create('/proj/WebRoot/hello.jsp')), 'gbk', 'nested file must match folder override');
  assert.strictEqual(getOverride(FileUri.create('/proj')), 'gbk', 'the folder itself matches');
  assert.strictEqual(getOverride(FileUri.create('/other/file.jsp')), undefined, 'unrelated file must not match');
});

test('KairoEncodingRegistry: per-file override still matches the file itself', () => {
  const reg = new KairoEncodingRegistry();
  reg.registerOverride({ parent: FileUri.create('/proj/hello.jsp'), encoding: 'gb18030' });
  const getOverride = (reg as unknown as { getEncodingOverride(u: URI): string | undefined }).getEncodingOverride.bind(reg);
  assert.strictEqual(getOverride(FileUri.create('/proj/hello.jsp')), 'gb18030');
  assert.strictEqual(getOverride(FileUri.create('/proj/other.jsp')), undefined);
});

test('KairoEncodingRegistry: stock extension and scheme branches preserved', () => {
  const reg = new KairoEncodingRegistry();
  reg.registerOverride({ extension: 'jsp', encoding: 'gbk' });
  reg.registerOverride({ scheme: 'user-storage', encoding: 'utf-8' });
  const getOverride = (reg as unknown as { getEncodingOverride(u: URI): string | undefined }).getEncodingOverride.bind(reg);
  assert.strictEqual(getOverride(FileUri.create('/any/where/page.jsp')), 'gbk', 'extension override works');
  assert.strictEqual(getOverride(new URI('user-storage:/user/settings.json')), 'utf-8', 'scheme override works');
  assert.strictEqual(getOverride(FileUri.create('/any/where/page.html')), undefined);
});
