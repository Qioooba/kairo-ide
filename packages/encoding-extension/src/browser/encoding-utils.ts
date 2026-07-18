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