/**
 * Lossless replacement for Theia's EncodingService.
 *
 * This service is shared by the browser and Node backend. Keep this module
 * free of browser-only dependencies: the backend performs the final encode
 * for incremental file writes and must not pull React or Theia's DOM shell
 * into its bundle.
 */

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { BinaryBuffer, BinaryBufferReadable } from '@theia/core/lib/common/buffer';
import { EncodingService, ResourceEncoding } from '@theia/core/lib/common/encoding-service';
import { Readable, consumeReadable } from '@theia/core/lib/common/stream';
import { I18nServiceSymbol } from '@kairo/i18n/lib/common';
import type { I18nService } from '@kairo/i18n/lib/common';

export class UnrepresentableEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnrepresentableEncodingError';
  }
}

const LOSSLESS_ENCODINGS = new Set([
  'utf8',
  'utf-8',
  'utf16le',
  'utf-16le',
  'utf16be',
  'utf-16be',
  'utf8bom',
  'utf-8-bom',
]);

@injectable()
export class KairoSafeEncodingService extends EncodingService {
  @inject(I18nServiceSymbol) @optional() protected i18n?: I18nService;

  override encode(value: string, options?: ResourceEncoding): BinaryBuffer {
    const encoded = super.encode(value, options);
    this.assertRoundTrip(value, encoded, options?.encoding);
    return encoded;
  }

  override async encodeStream(
    value: string | Readable<string>,
    options?: ResourceEncoding,
  ): Promise<BinaryBuffer | BinaryBufferReadable> {
    // Theia passes undefined for an empty New File through this nominally
    // non-null API. Preserve its behavior instead of consuming the value.
    if (value === undefined || value === null) {
      return super.encodeStream(value as string, options);
    }
    if (typeof value === 'string') {
      const encoded = super.encode(value, options);
      this.assertRoundTrip(value, encoded, options?.encoding);
      return super.encodeStream(value, options);
    }
    const encoding = options?.encoding;
    if (!encoding || LOSSLESS_ENCODINGS.has(encoding.toLowerCase())) {
      return super.encodeStream(value, options);
    }
    const text = consumeReadable(value, strings => strings.join(''));
    const encoded = super.encode(text, options);
    this.assertRoundTrip(text, encoded, encoding);
    return super.encodeStream(text, options);
  }

  protected assertRoundTrip(value: string, encoded: BinaryBuffer, encoding?: string): void {
    if (!encoding || LOSSLESS_ENCODINGS.has(encoding.toLowerCase())) {
      return;
    }
    const roundTripped = this.decode(encoded, encoding);
    if (roundTripped === value) {
      return;
    }
    let i = 0;
    while (i < value.length && i < roundTripped.length && value[i] === roundTripped[i]) {
      i++;
    }
    const badChar = value[i] ?? '?';
    const codePoint = value.codePointAt(i);
    const hex = codePoint !== undefined ? `U+${codePoint.toString(16).toUpperCase()}` : 'U+????';
    const before = value.slice(0, i);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    const detail = this.i18n?.t('encoding.cannotEncodeDetail', {
      char: badChar,
      hex,
      line: String(line),
      col: String(col),
      encoding: encoding ?? '',
    });
    throw new UnrepresentableEncodingError(
      detail ??
        `Cannot save: character '${badChar}' (${hex}) at line ${line}, column ${col} ` +
          `is not representable in ${encoding}. The file was NOT modified. ` +
          'Use "Kairo: Save with Encoding…" with an encoding that can represent it (utf-8 is always safe).',
    );
  }
}
