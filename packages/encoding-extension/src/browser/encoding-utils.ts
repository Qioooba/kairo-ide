/**
 * Pure encoding utility functions and constants.
 *
 * These have zero dependencies on Theia, inversify, or the
 * browser DOM. They are safe to import in Node.js tests.
 */

export const KAIRO_ENCODING_OPTIONS: readonly string[] = [
  'utf-8',
  'utf-8-bom',
  'gbk',
  'gb18030',
  'iso-8859-1',
  'us-ascii',
  'utf-16le',
  'utf-16be',
];

export const SUPPORTS_ENCODER: ReadonlySet<string> = new Set([
  'utf-8',
  'utf-16le',
  'utf-16be',
]);

export function normalizeEncodingLabel(encoding: string): string {
  switch (encoding) {
    case 'utf-8-bom':
      return 'utf-8';
    case 'gbk':
    case 'gb18030':
    case 'gb2312':
    case 'iso-8859-1':
    case 'us-ascii':
    case 'utf-8':
    case 'utf-16le':
    case 'utf-16be':
      return encoding;
    default:
      // Pass through; the engine will reject unknown labels.
      return encoding;
  }
}

/**
 * Kairo display labels → Theia SUPPORTED_ENCODINGS ids. Theia's
 * editor encoding status bar indexes SUPPORTED_ENCODINGS with
 * the model's encoding and CRASHES on unknown ids ("Cannot read
 * properties of undefined (reading 'labelShort')", KAIRO-RC-WEB-260)
 * — so anything fed into Monaco models or the EncodingRegistry
 * override must use Theia ids, not Kairo labels.
 */
const KAIRO_TO_THEIA_ENCODING: Readonly<Record<string, string>> = {
  'utf-8': 'utf8',
  'utf-8-bom': 'utf8bom',
  'utf-16le': 'utf16le',
  'utf-16be': 'utf16be',
  'iso-8859-1': 'iso88591',
  gbk: 'gbk',
  gb18030: 'gb18030',
  // Theia has no us-ascii entry; UTF-8 decodes ASCII identically.
  'us-ascii': 'utf8',
};

export function toTheiaEncodingId(label: string): string {
  return KAIRO_TO_THEIA_ENCODING[label.toLowerCase()] ?? label;
}