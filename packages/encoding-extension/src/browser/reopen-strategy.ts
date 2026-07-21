/**
 * Reload strategy for "Kairo: Reopen with Encoding…"
 * (KAIRO-RC-WEB-206 follow-up).
 *
 * The command used to close the editor and re-open it through
 * EditorManager. The Monaco model reference was still alive at
 * re-open time, so the editor came back over the SAME cached
 * UTF-8-decoded model — the file was never re-decoded and a
 * later save wrote the mojibake back as UTF-8 bytes, silently
 * corrupting GBK files.
 *
 * The strategy here prefers Theia's native
 * `editor.setEncoding(picked, EncodingMode.Decode)` on the LIVE
 * editor: the model re-reads the file through FileService with
 * the new encoding and swaps its content in place. Editors
 * without setEncoding fall back to close/reopen, waiting for
 * onDidDispose first (KAIRO-RC-WEB-233: re-opening immediately
 * raced disposal and killed the editor with "Model is
 * disposed!").
 *
 * Kept DOM-free (structural interfaces, no @theia/browser
 * imports) so the node:test suite can exercise it directly.
 */

/** EncodingMode.Decode from @theia/editor — re-read + re-decode. */
export const ENCODING_MODE_DECODE = 1;

export interface ReopenCapableEditor {
  setEncoding?(encoding: string, mode: number): unknown;
  document: { dirty: boolean };
}

export interface EditorWidgetLike {
  editor: ReopenCapableEditor;
  close(): void;
  onDidDispose(cb: () => void): void;
}

export interface EditorManagerLike {
  open(uri: unknown): Promise<unknown>;
}

export interface ReopenMessages {
  warn(message: string): void;
}

export type ReopenOutcome = 'redecoded' | 'reopened' | 'refused-dirty';

/**
 * Reload `widget` so its content is decoded with `encoding`.
 * The caller must register the encoding override BEFORE calling
 * this so both the re-decode and later saves resolve it.
 */
export async function reloadEditorWithEncoding(
  widget: EditorWidgetLike,
  uri: unknown,
  encoding: string,
  editorManager: EditorManagerLike,
  messages: ReopenMessages,
): Promise<ReopenOutcome> {
  const editor = widget.editor;
  if (typeof editor.setEncoding === 'function') {
    if (editor.document.dirty) {
      messages.warn('The file is dirty. Save it before reopening with another encoding.');
      return 'refused-dirty';
    }
    await editor.setEncoding(encoding, ENCODING_MODE_DECODE);
    return 'redecoded';
  }
  const disposed = new Promise<void>(resolve => widget.onDidDispose(() => resolve()));
  widget.close();
  await disposed;
  await editorManager.open(uri);
  return 'reopened';
}
