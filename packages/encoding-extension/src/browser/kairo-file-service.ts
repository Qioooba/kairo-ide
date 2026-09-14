/**
 * KairoFileService — surfaces encoding save refusals to the user.
 *
 * MonacoEditorModel.run() swallows save errors with a bare
 * console.error, so a rejected save never rejects the outer
 * promise: no notification, the dirty dot just stays (flow-03
 * live evidence: emoji-in-GBK save correctly blocked at the byte
 * level, but the user saw NOTHING). The failure does pass
 * through FileService.write / FileService.update on its way to
 * the void, so this subclass reports encoding refusals as error
 * notifications and rethrows.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { Readable, consumeReadable } from '@theia/core/lib/common/stream';
import { KairoEncodingServiceImpl } from './encoding-service';
import { FileService, WriteTextFileOptions, UpdateTextFileOptions } from '@theia/filesystem/lib/browser/file-service';
import { FileStatWithMetadata } from '@theia/filesystem/lib/common/files';
import type { TextDocumentContentChangeEvent } from '@theia/core/shared/vscode-languageserver-protocol';
import { escapeProperties, isPropertiesPath } from './properties-escape';
import { toKairoEncodingId, toTheiaEncodingId } from './encoding-utils';

export class UnrepresentableEncodingError extends Error {
  constructor(public readonly encoding: string, detail?: string) {
    super(`Character cannot be represented in ${encoding}${detail ? `: ${detail}` : ''}`);
    this.name = 'UnrepresentableEncodingError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isEncodingRefusal(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | undefined;
  return !!e && (e.name === 'UnrepresentableEncodingError' || /not representable|cannot be represented/i.test(e.message || ''));
}

function offsetAt(text: string, line: number, character: number): number {
  if (line <= 0) {
    return Math.min(Math.max(character, 0), text.length);
  }
  let currentLine = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      currentLine++;
      if (currentLine === line) {
        return Math.min(i + 1 + Math.max(character, 0), text.length);
      }
    }
  }
  return text.length;
}

/** Apply LSP content changes against a snapshot, then return the full text. */
export function applyContentChanges(text: string, changes: readonly TextDocumentContentChangeEvent[]): string {
  const isFull = (change: TextDocumentContentChangeEvent): change is { text: string } =>
    !('range' in change);
  const full = [...changes].reverse().find(isFull);
  if (full && changes.every(isFull)) {
    return full.text;
  }
  const ranged = changes.filter((change): change is TextDocumentContentChangeEvent & {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
  } => 'range' in change);
  const ordered = [...ranged].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) {
      return b.range.start.line - a.range.start.line;
    }
    return b.range.start.character - a.range.start.character;
  });
  let next = text;
  for (const change of ordered) {
    const start = offsetAt(next, change.range.start.line, change.range.start.character);
    const end = offsetAt(next, change.range.end.line, change.range.end.character);
    next = next.slice(0, start) + change.text + next.slice(end);
  }
  return next;
}

function asString(value: string | Readable<string>): string {
  if (typeof value === 'string') {
    return value;
  }
  return consumeReadable(value, chunks => chunks.join(''));
}

@injectable()
export class KairoFileService extends FileService {
  @inject(MessageService) protected readonly kairoMessages!: MessageService;
  @inject(KairoEncodingServiceImpl) protected readonly encodingSvc!: KairoEncodingServiceImpl;

  protected reportIfEncodingRefusal(err: unknown): void {
    if (isEncodingRefusal(err)) {
      this.kairoMessages.error((err as Error).message);
    }
  }

  /**
   * Java 6 .properties default: ISO-8859-1 + \\uXXXX.
   * Skip only for an explicit "Save with Encoding" UTF-8
   * (`overwriteEncoding` plus utf-8 / utf-8-bom). A project-wide
   * UTF-8 default must not disable native2ascii — that is BUG-20260828-603.
   */
  protected shouldEscapeProperties(resource: URI, options?: { encoding?: string; overwriteEncoding?: boolean }): boolean {
    if (!isPropertiesPath(resource.path.toString()) && !isPropertiesPath(resource.toString())) {
      return false;
    }
    if (options?.overwriteEncoding && options.encoding) {
      const kairo = toKairoEncodingId(options.encoding);
      if (kairo === 'utf-8' || kairo === 'utf-8-bom') {
        return false;
      }
    }
    return true;
  }

  override async write(resource: URI, value: string | Readable<string>, options?: WriteTextFileOptions): Promise<FileStatWithMetadata & { encoding: string }> {
    try {
      let payload: string | Readable<string> = value;
      let writeOptions = options;
      if (this.shouldEscapeProperties(resource, options)) {
        payload = escapeProperties(asString(value));
        writeOptions = {
          ...options,
          encoding: toTheiaEncodingId('iso-8859-1'),
          overwriteEncoding: true,
        };
      } else {
        const text = asString(value);
        if (typeof value !== 'string') {
          payload = text;
        }
        const targetEncoding = writeOptions?.encoding || this.encodingSvc.getEncoding(resource);
        const kairoId = toKairoEncodingId(targetEncoding);
        if (kairoId !== 'utf-8' && kairoId !== 'utf-8-bom') {
          const validation = await this.encodingSvc.validateEncoding(text, kairoId);
          if (!validation.valid) {
            throw new UnrepresentableEncodingError(kairoId, validation.error);
          }
        }
      }
      const stat = await super.write(resource, payload, writeOptions);
      this.encodingSvc.invalidateEncodingCache(resource);
      return stat;
    } catch (err) {
      this.reportIfEncodingRefusal(err);
      throw err;
    }
  }

  override async update(resource: URI, changes: TextDocumentContentChangeEvent[], options: UpdateTextFileOptions): Promise<FileStatWithMetadata & { encoding: string }> {
    try {
      if (this.shouldEscapeProperties(resource, options)) {
        const current = await super.read(resource, { encoding: options.encoding });
        const next = escapeProperties(applyContentChanges(current.value, changes));
        const stat = await super.write(resource, next, {
          encoding: toTheiaEncodingId('iso-8859-1'),
          overwriteEncoding: true,
          mtime: options.mtime,
          etag: options.etag,
        });
        this.encodingSvc.invalidateEncodingCache(resource);
        return stat;
      }
      const targetEncoding = options?.encoding || this.encodingSvc.getEncoding(resource);
      const kairoId = toKairoEncodingId(targetEncoding);
      if (kairoId !== 'utf-8' && kairoId !== 'utf-8-bom') {
        const current = await super.read(resource, { encoding: toTheiaEncodingId(kairoId) });
        const next = applyContentChanges(current.value, changes);
        const validation = await this.encodingSvc.validateEncoding(next, kairoId);
        if (!validation.valid) {
          throw new UnrepresentableEncodingError(kairoId, validation.error);
        }
      }
      const stat = await super.update(resource, changes, options);
      this.encodingSvc.invalidateEncodingCache(resource);
      return stat;
    } catch (err) {
      this.reportIfEncodingRefusal(err);
      throw err;
    }
  }
}
