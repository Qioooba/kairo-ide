/**
 * KAIRO-RC-WEB-229 — validating replacement for Theia's
 * EncodingService.
 *
 * Theia encodes writes with iconv-lite, which SILENTLY replaces
 * characters the target encoding cannot represent with '?'
 * (0x3F). A GBK file edited to contain e.g. an emoji and saved
 * with a plain Ctrl/Cmd+S was byte-modified without any warning
 * — data corruption on the product's core value proposition.
 *
 * This subclass performs a round-trip check after encoding:
 * if decode(encode(text)) !== text, the save is refused with an
 * error naming the character, its code point, its line/column,
 * and the encoding. UTF-8/-16 paths are lossless by design and
 * skip the check.
 */

import { injectable } from '@theia/core/shared/inversify';
import { EncodingService, ResourceEncoding } from '@theia/core/lib/common/encoding-service';
import { BinaryBuffer, BinaryBufferReadable } from '@theia/core/lib/common/buffer';
import { Readable } from '@theia/core/lib/common/stream';

export class UnrepresentableEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnrepresentableEncodingError';
  }
}

const LOSSLESS_ENCODINGS = new Set(['utf8', 'utf-8', 'utf16le', 'utf-16le', 'utf16be', 'utf-16be', 'utf8bom', 'utf-8-bom']);

@injectable()
export class KairoSafeEncodingService extends EncodingService {
  override encode(value: string, options?: ResourceEncoding): BinaryBuffer {
    const encoded = super.encode(value, options);
    this.assertRoundTrip(value, encoded, options?.encoding);
    return encoded;
  }

  override async encodeStream(value: string | Readable<string>, options?: ResourceEncoding): Promise<BinaryBuffer | BinaryBufferReadable> {
    if (typeof value === 'string') {
      // Validate the round trip first (throws UnrepresentableEncodingError
      // on data loss), then return Theia's own encodeStream result so the
      // on-the-wire shape is EXACTLY what stock Theia produces. Returning
      // a BinaryBuffer here broke saves for non-UTF-8 encodings: the file
      // service's readable-oriented RPC path mangled it, the backend logged
      // "Could not find typed array for code 255", and the editor cleared
      // its dirty flag without a single byte written (KAIRO-RC-WEB-250).
      const encoded = super.encode(value, options);
      this.assertRoundTrip(value, encoded, options?.encoding);
      return super.encodeStream(value, options);
    }
    return super.encodeStream(value, options);
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
    const hex = codePoint !== undefined ? 'U+' + codePoint.toString(16).toUpperCase() : 'U+????';
    const before = value.slice(0, i);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    throw new UnrepresentableEncodingError(
      `Cannot save: character '${badChar}' (${hex}) at line ${line}, column ${col} ` +
      `is not representable in ${encoding}. The file was NOT modified. ` +
      'Use "Kairo: Save with Encoding…" with an encoding that can represent it (utf-8 is always safe).',
    );
  }
}
