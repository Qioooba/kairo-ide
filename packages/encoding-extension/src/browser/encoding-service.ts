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

import { injectable, inject } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { EncodingRegistry } from '@theia/core/lib/browser/encoding-registry';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MessageService } from '@theia/core/lib/common';
import { RuntimeConnectionService, KairoError } from '@kairo/runtime-extension';
import type {
  EncodingDetectRequest,
  EncodingDetectResponse,
  EncodingRecodeRequest,
  EncodingRecodeResponse,
} from '@kairo/protocol';
import {
  KAIRO_ENCODING_OPTIONS,
  SUPPORTS_ENCODER,
  normalizeEncodingLabel,
} from './encoding-utils';

export { KAIRO_ENCODING_OPTIONS, SUPPORTS_ENCODER, normalizeEncodingLabel } from './encoding-utils';

export const KairoEncodingService = Symbol('KairoEncodingService');

export interface DetectArgs {
  workspaceId: string;
  file: string;
  sampleBytes?: number;
}

export interface SetEncodingResult {
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
  @inject(FileService) protected fileService!: FileService;
  @inject(EncodingRegistry) protected encodingRegistry!: EncodingRegistry;
  @inject(MessageService) protected messages!: MessageService;

  /**
   * In-memory cache of "this URI is currently displayed as
   * <encoding>" so the status bar can render the value
   * synchronously without re-running detect. The agent
   * remains the source of truth on disk; this cache only
   * exists to keep the UI snappy.
   */
  protected cache = new Map<string, string>();

  async detect(args: DetectArgs): Promise<EncodingDetectResponse> {
    const payload: EncodingDetectRequest = {
      workspaceId: args.workspaceId,
      file: args.file,
      sampleBytes: args.sampleBytes,
    };
    try {
      const r = await this.runtime.request('POST /api/v1/encoding/detect', payload);
      this.cache.set(args.file, r.encoding);
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
      from: args.from,
      to: args.to,
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
   * Register a per-URI encoding override with Theia's
   * EncodingRegistry and update the local cache. This is the
   * single point where "this file uses X" is recorded.
   */
  setEncodingFor(uri: URI, encoding: string): SetEncodingResult {
    if (!KAIRO_ENCODING_OPTIONS.includes(encoding) && !encoding.match(/^[a-z0-9-]+$/i)) {
      throw new KairoError({ code: 'invalid_request', message: `unknown encoding: ${encoding}` });
    }
    const prev = this.encodingRegistry.getEncodingForResource(uri);
    this.encodingRegistry.registerOverride({
      parent: uri,
      encoding,
    });
    this.cache.set(uri.toString(), encoding);
    return { encoding, changed: prev !== encoding };
  }

  /**
   * Synchronous encoding lookup. Theia resolves via
   * EncodingRegistry which already accounts for the
   * registered override; this is the value the status bar
   * and save override should trust.
   */
  getEncodingFor(uri: URI): string {
    const cached = this.cache.get(uri.toString());
    if (cached) return cached;
    const v = this.encodingRegistry.getEncodingForResource(uri);
    this.cache.set(uri.toString(), v);
    return v;
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
    const c = await this.fileService.read(uri, {
      encoding: normalizeEncodingLabel(encoding),
    });
    this.cache.set(uri.toString(), encoding);
    return c.value;
  }

  /**
   * Write the given text to a file with the chosen encoding.
   * Throws if the encoding cannot represent some character
   * — the caller is expected to surface that to the user
   * and refuse to mark the model as not dirty.
   */
  async writeWithEncoding(uri: URI, text: string, encoding: string): Promise<void> {
    await this.fileService.write(uri, text, {
      encoding: normalizeEncodingLabel(encoding),
      overwriteEncoding: true,
    });
    this.cache.set(uri.toString(), encoding);
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
      // Fast path: UTF-8 is always valid
      if (targetEncoding === 'UTF-8' || targetEncoding === 'utf-8' || targetEncoding === 'utf-8-bom') {
          return { valid: true };
      }
      // Call Go Agent for server-side validation
      try {
          const result = await this.runtime.request('POST /api/v1/encoding/validate', {
              text,
              encoding: targetEncoding,
          });
          return { valid: result.valid, error: result.error };
      } catch (err) {
          return { valid: false, error: `validation failed: ${(err as Error).message}` };
      }
  }
}
