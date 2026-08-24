/**
 * Kairo encoding service — owns per-URI encoding state, drives
 * the agent's detect / recode endpoints, and intercepts the
 * Theia save flow so files round-trip with the right bytes
 * (GBK, GB18030, UTF-8-BOM, ISO-8859-1, etc.) instead of the
 * Theia default UTF-8.
 *
 * The contract for v0.3-encoding:
 *
 *   - On open, the file's encoding is resolved via the agent
 *     and stored here (per URI, NOT per Monaco model — the
 *     model is just a UTF-16 view).
 *   - "Reopen with Encoding" sets the override, then reloads
 *     the file by closing and re-opening via the EditorManager.
 *   - "Save with Encoding" sets the override, then writes the
 *     current model through FileService.writeFile with the
 *     encoding option.
 *   - Plain save (no explicit user choice) ALSO goes through
 *     us: if a per-URI encoding is set, we save with that
 *     encoding. Otherwise we let Theia do its default UTF-8.
 *   - When a file is dirty AND the chosen encoding cannot
 *     represent a character in the model, save is refused
 *     with a clear error in the status bar / message service.
 *
 * We deliberately do NOT pretend Monaco understands GBK.
 * Monaco models are always UTF-16 in memory; the encoding
 * round-trip happens on read (bytes -> UTF-16) and on write
 * (UTF-16 -> bytes), using the browser's TextDecoder /
 * TextEncoder (Chrome supports gbk / gb18030 / gb2312) and
 * the agent's recode endpoint as the authoritative source.
 */

import { injectable, inject, Container } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { EncodingRegistry } from '@theia/core/lib/browser/encoding-registry';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MessageService } from '@theia/core/lib/common';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';
import type {
  EncodingDetectRequest,
  EncodingDetectResponse,
  EncodingRecodeRequest,
  EncodingRecodeResponse,
} from '@kairo/protocol';
import {
  KAIRO_ENCODING_OPTIONS,
  toTheiaEncodingId,
  toKairoEncodingId,
  toGoEncodingId,
  sameEncodingId,
} from './encoding-utils';

export {
  KAIRO_ENCODING_OPTIONS,
  SUPPORTS_ENCODER,
  normalizeEncodingLabel,
  toTheiaEncodingId,
  toKairoEncodingId,
  toGoEncodingId,
  fromTheiaEncodingId,
  sameEncodingId,
} from './encoding-utils';

export const KairoEncodingService = Symbol('KairoEncodingService');

export interface DetectArgs {
  workspaceId: string;
  file: string;
  sampleBytes?: number;
}

export interface SetEncodingResult {
  /** Kairo canonical encoding id. */
  encoding: string;
  /** True if the encoding was newly registered (vs. preserved). */
  changed: boolean;
}

/**
 * The encoding override scope:
 *   - 'file' — only this URI. Cleared when the file is closed
 *     and the override is no longer in EncodingRegistry.
 *   - 'folder' — applies to every file under the URI's
 *     directory unless a more specific override is set.
 *
 * For a v0.3-encoding round we only do 'file'; 'folder' is
 * a follow-up that pairs nicely with project encoding
 * defaults.
 */
export type EncodingOverrideScope = 'file';

@injectable()
export class KairoEncodingServiceImpl {
  @inject(RuntimeConnectionService) protected runtime!: RuntimeConnectionService;
  /**
   * N-054: FileService is resolved LAZILY. The production (minified)
   * bundle rebinds FileService to KairoFileService, which injects
   * KairoEncodingServiceImpl — an eager @inject(FileService) here
   * creates the construction-time cycle
   * FileService → KairoEncodingServiceImpl → FileService
   * ("Circular dependency found" on frontend boot). Resolving through
   * the container on first use breaks the cycle: by the time any
   * encoding API runs, the FileService singleton already exists.
   */
  @inject(Container) protected readonly container!: Container;
  protected _fileService: FileService | undefined;
  protected get fileService(): FileService {
    if (!this._fileService) {
      this._fileService = this.container.get(FileService);
    }
    return this._fileService;
  }
  @inject(EncodingRegistry) protected encodingRegistry!: EncodingRegistry;
  @inject(MessageService) protected messages!: MessageService;

  /**
   * In-memory cache of "this URI is currently displayed as
   * <Kairo encoding id>" so the status bar can render the value
   * synchronously without re-running detect. Keys are always
   * Theia URI strings; values are always Kairo canonical ids
   * (BD-P1-7). The agent remains the source of truth on disk.
   */
  protected cache = new Map<string, string>();

  /**
   * Fired whenever the effective encoding for a URI changes
   * (override registered, save-with-encoding, project default).
   * The Kairo status bar subscribes to this: without it the
   * "Encoding:" element only refreshed on current-editor change,
   * so after "Reopen with Encoding" (which now keeps the same
   * editor alive) it kept showing the STALE pre-reopen encoding.
   */
  protected readonly onDidChangeEncodingEmitter = new Emitter<string>();
  readonly onDidChangeEncoding: Event<string> = this.onDidChangeEncodingEmitter.event;

  async detect(args: DetectArgs): Promise<EncodingDetectResponse> {
    const payload: EncodingDetectRequest = {
      workspaceId: args.workspaceId,
      file: args.file,
      sampleBytes: args.sampleBytes,
    };
    try {
      const r = await this.runtime.request('POST /api/v1/encoding/detect', payload);
      // Cache under URI key with Kairo id (never raw fs-path / Theia id).
      const cacheKey = FileUri.create(args.file).toString();
      this.cache.set(cacheKey, toKairoEncodingId(r.encoding));
      return r;
    } catch (err) {
      if (err instanceof KairoError) throw err;
      throw new KairoError({
        code: 'internal',
        message: `encoding detection failed: ${(err as Error).message}`,
        cause: err,
      });
    }
  }

  /**
   * Recode a file in place. Used by "Save with Encoding" and
   * by the bulk tools (project-wide re-encode). The user
   * must explicitly ask — we never recode on plain save.
   * `from` / `to` are converted to Go canonical ids at the wire.
   */
  async recode(args: {
    workspaceId: string;
    file: string;
    from: string;
    to: string;
    eol?: 'lf' | 'crlf' | 'cr';
  }): Promise<EncodingRecodeResponse> {
    const payload: EncodingRecodeRequest = {
      workspaceId: args.workspaceId,
      file: args.file,
      from: toGoEncodingId(args.from),
      to: toGoEncodingId(args.to),
      eol: args.eol,
    };
    try {
      return await this.runtime.request('POST /api/v1/encoding/recode', payload);
    } catch (err) {
      if (err instanceof KairoError) throw err;
      throw new KairoError({
        code: 'internal',
        message: `encoding recode failed: ${(err as Error).message}`,
        cause: err,
      });
    }
  }

  /**
   * The status bar passes `editor.document.uri`, which is a
   * Monaco Uri — same string form but NOT a Theia URI instance,
   * so EncodingRegistry lookups crashed with
   * "e.isEqualOrParent is not a function" (KAIRO-RC-WEB-020).
   * Coerce at the boundary so every caller is safe.
   */
  protected asTheiaUri(uri: URI): URI {
    if (uri instanceof URI) {
      return uri;
    }
    // Monaco Uri (or any string-coercible uri-like) — rebuild a
    // real Theia URI. TS narrows the else branch to never because
    // the declared type is already URI, hence the cast.
    return new URI(String(uri as unknown as { toString(): string }));
  }

  /**
   * Registered per-file override disposables keyed by URI string.
   * A URI must have AT MOST ONE per-file override: the registry's
   * exact-match pass returns the first registration, so a second
   * "Save with Encoding" on the same file would keep writing the
   * OLD encoding while the UI claims the new one (flow-03 live
   * evidence: Save-as-GBK reported success, bytes stayed UTF-8).
   */
  protected overrideDisposables = new Map<string, { dispose(): void }>();

  /**
   * Project-root and directory-level override disposables (BD-P1-10).
   * Must be retained and disposed on project switch — otherwise
   * overrides accumulate forever and shadow newer projects.
   */
  protected projectOverrideDisposable: { dispose(): void } | undefined;
  protected directoryOverrideDisposables: { dispose(): void }[] = [];

  /** Drop project/directory overrides and invalidate the cache. */
  clearProjectScopedOverrides(): void {
    this.projectOverrideDisposable?.dispose();
    this.projectOverrideDisposable = undefined;
    for (const d of this.directoryOverrideDisposables) {
      d.dispose();
    }
    this.directoryOverrideDisposables = [];
    this.cache.clear();
  }

  /**
   * Register a per-URI encoding override with Theia's
   * EncodingRegistry and update the local cache. This is the
   * single point where "this file uses X" is recorded.
   * `encoding` may be Kairo or Theia; cache always stores Kairo.
   */
  setEncodingFor(uri: URI, encoding: string): SetEncodingResult {
    const kairo = toKairoEncodingId(encoding);
    if (!KAIRO_ENCODING_OPTIONS.includes(kairo) && !kairo.match(/^[a-z0-9-]+$/i)) {
      throw new KairoError({ code: 'invalid_request', message: `unknown encoding: ${encoding}` });
    }
    // Store Theia encoding ids in the registry — Kairo display
    // labels like 'utf-8' crash Theia's encoding status bar
    // (SUPPORTED_ENCODINGS lookup, KAIRO-RC-WEB-260).
    const theiaEncoding = toTheiaEncodingId(kairo);
    const theiaUri = this.asTheiaUri(uri);
    const key = theiaUri.toString();
    const prev = toKairoEncodingId(this.encodingRegistry.getEncodingForResource(theiaUri));
    this.overrideDisposables.get(key)?.dispose();
    this.overrideDisposables.set(key, this.encodingRegistry.registerOverride({
      parent: theiaUri,
      encoding: theiaEncoding,
    }));
    this.cache.set(key, kairo);
    this.onDidChangeEncodingEmitter.fire(kairo);
    return { encoding: kairo, changed: !sameEncodingId(prev, kairo) };
  }

  /**
   * Synchronous encoding lookup. Returns a Kairo canonical id
   * so UI comparisons (pickEncoding / "Already using X") work
   * against KAIRO_ENCODING_OPTIONS (BD-P1-7 / BD-P1-8).
   */
  getEncodingFor(uri: URI): string {
    const theiaUri = this.asTheiaUri(uri);
    const key = theiaUri.toString();
    const cached = this.cache.get(key);
    if (cached) return cached;
    const v = toKairoEncodingId(this.encodingRegistry.getEncodingForResource(theiaUri));
    this.cache.set(key, v);
    return v;
  }

  /**
   * Drop the cached encoding for one URI (BD-P1-7). The next
   * {@link getEncodingFor} re-reads the registry. Fires
   * {@link onDidChangeEncoding} when an entry was removed so tab /
   * status-bar UI refresh.
   */
  invalidateEncodingCache(uri: URI): boolean {
    const key = this.asTheiaUri(uri).toString();
    if (!this.cache.delete(key)) {
      return false;
    }
    this.onDidChangeEncodingEmitter.fire(
      toKairoEncodingId(this.encodingRegistry.getEncodingForResource(new URI(key))),
    );
    return true;
  }

  /**
   * Apply a project-wide default encoding: every file under
   * rootUri resolves to `encoding` unless a more specific
   * per-file override exists (KAIRO-RC-WEB-206 — previously a
   * GBK project's files opened as UTF-8 mojibake because only
   * explicit per-file overrides were ever registered).
   */
  applyProjectEncoding(rootUri: URI, encoding: string): void {
    const kairo = toKairoEncodingId(encoding);
    const theia = toTheiaEncodingId(kairo);
    this.projectOverrideDisposable?.dispose();
    this.projectOverrideDisposable = this.encodingRegistry.registerOverride({
      parent: this.asTheiaUri(rootUri),
      encoding: theia,
    });
    this.cache.clear();
    this.onDidChangeEncodingEmitter.fire(kairo);
  }

  /**
   * Apply per-directory encoding overrides from project config.
   * Each override maps a directory path (relative to project root)
   * to an encoding. Registered as folder-level overrides so files
   * under each directory open with the correct encoding.
   * Previous directory overrides are disposed first (BD-P1-10).
   */
  applyDirectoryEncodingOverrides(
    rootUri: URI,
    overrides: Record<string, string>,
  ): void {
    for (const d of this.directoryOverrideDisposables) {
      d.dispose();
    }
    this.directoryOverrideDisposables = [];
    const theiaRoot = this.asTheiaUri(rootUri);
    for (const [dirPath, encoding] of Object.entries(overrides)) {
      const kairo = toKairoEncodingId(encoding);
      if (!KAIRO_ENCODING_OPTIONS.includes(kairo) && !kairo.match(/^[a-z0-9-]+$/i)) {
        continue;
      }
      const theia = toTheiaEncodingId(kairo);
      const dirUri = theiaRoot.resolve(dirPath.endsWith('/') ? dirPath : dirPath + '/');
      this.directoryOverrideDisposables.push(
        this.encodingRegistry.registerOverride({
          parent: dirUri,
          encoding: theia,
        }),
      );
    }
    this.cache.clear();
  }

  /**
   * Read the file with the chosen encoding. The override
   * must have been registered first (see setEncodingFor) so
   * the next FileService.read also picks it up. This
   * explicit read is for the "Reopen with Encoding" UI:
   * we read once with the new encoding, then re-create the
   * editor so the model is built from the new text.
   */
  async readWithEncoding(uri: URI, encoding: string): Promise<string> {
    const kairo = toKairoEncodingId(encoding);
    const c = await this.fileService.read(uri, {
      encoding: toTheiaEncodingId(kairo),
    });
    this.cache.set(this.asTheiaUri(uri).toString(), kairo);
    return c.value;
  }

  /**
   * Write the given text to a file with the chosen encoding.
   * Throws if the encoding cannot represent some character
   * — the caller is expected to surface that to the user
   * and refuse to mark the model as not dirty.
   */
  async writeWithEncoding(uri: URI, text: string, encoding: string): Promise<void> {
    const kairo = toKairoEncodingId(encoding);
    await this.fileService.write(uri, text, {
      encoding: toTheiaEncodingId(kairo),
      overwriteEncoding: true,
    });
    this.cache.set(this.asTheiaUri(uri).toString(), kairo);
  }

  /**
   * Validate that the given text can be represented in the target
   * encoding. For UTF-8 the check is always true (fast path). For
   * every other encoding we call the Go agent's
   * /api/v1/encoding/validate endpoint, which uses
   * golang.org/x/text to perform a real byte-safe round-trip check.
   *
   * This replaces the old canEncode() which used TextEncoder —
   * TextEncoder only produces UTF-8, so it could never validate
   * GBK, ISO-8859-1, or any other non-UTF-8 encoding (V-025).
   */
  async validateEncoding(text: string, targetEncoding: string): Promise<{ valid: boolean; error?: string }> {
      const kairo = toKairoEncodingId(targetEncoding);
      // Fast path: UTF-8 is always valid
      if (kairo === 'utf-8' || kairo === 'utf-8-bom') {
          return { valid: true };
      }
      // Call Go Agent for server-side validation (Go canonical id)
      try {
          const result = await this.runtime.request('POST /api/v1/encoding/validate', {
              text,
              encoding: toGoEncodingId(kairo),
          });
          return { valid: result.valid, error: result.error };
      } catch (err) {
          return { valid: false, error: `validation failed: ${(err as Error).message}` };
      }
  }
}
