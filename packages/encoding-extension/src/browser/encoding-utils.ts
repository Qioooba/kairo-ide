/**
 * EncodingIdent — single source of truth for encoding id domains.
 *
 * Kairo / protocol / Go agent use hyphenated labels:
 *   utf-8, utf-8-bom, gbk, iso-8859-1, …
 * Theia / Monaco SUPPORTED_ENCODINGS use condensed ids:
 *   utf8, utf8bom, gbk, iso88591, …
 *
 * Every boundary (UI pick, registry override, agent wire, cache)
 * MUST convert through these helpers. Comparing or caching across
 * domains without conversion is a bug (see audit S3 / BD-P1-6..8).
 *
 * Pure functions — zero Theia / inversify / DOM dependencies.
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

/**
 * Collapse labels for TextDecoder / browser encode paths that do
 * not distinguish BOM. Do NOT use this for FileService read/write
 * or agent wire — those must preserve utf-8-bom via toTheiaEncodingId
 * / toGoEncodingId (BD-P0-1).
 */
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

/** Kairo display / protocol / Go canonical ids → Theia SUPPORTED_ENCODINGS ids. */
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

/** Theia SUPPORTED_ENCODINGS ids → Kairo / Go canonical ids. */
const THEIA_TO_KAIRO_ENCODING: Readonly<Record<string, string>> = {
  utf8: 'utf-8',
  utf8bom: 'utf-8-bom',
  utf16le: 'utf-16le',
  utf16be: 'utf-16be',
  iso88591: 'iso-8859-1',
  gbk: 'gbk',
  gb18030: 'gb18030',
};

/**
 * Normalize any known alias (Kairo, Theia, or common Go synonym)
 * to the Kairo / protocol / Go canonical id.
 */
export function toKairoEncodingId(id: string): string {
  const lower = id.toLowerCase().trim();
  if (THEIA_TO_KAIRO_ENCODING[lower]) {
    return THEIA_TO_KAIRO_ENCODING[lower];
  }
  if (KAIRO_TO_THEIA_ENCODING[lower]) {
    return lower;
  }
  // Extra Go / XML / HTML synonyms that are not Theia ids.
  switch (lower) {
    case 'utf8':
      return 'utf-8';
    case 'utf8bom':
    case 'utf-8-bom':
      return 'utf-8-bom';
    case 'latin1':
    case 'latin-1':
    case 'iso8859-1':
      return 'iso-8859-1';
    case 'ascii':
      return 'us-ascii';
    case 'gb2312':
    case 'cp936':
    case 'ms936':
      return 'gbk';
    default:
      return lower;
  }
}

/** Wire id for the Go agent — same canonical set as Kairo. */
export function toGoEncodingId(id: string): string {
  return toKairoEncodingId(id);
}

/**
 * Kairo (or any alias) → Theia SUPPORTED_ENCODINGS id.
 * Idempotent for already-Theia ids (utf8 → utf8).
 * Anything fed into Monaco models or EncodingRegistry overrides
 * must use this — unknown ids crash Theia's status bar
 * (KAIRO-RC-WEB-260).
 */
export function toTheiaEncodingId(label: string): string {
  const kairo = toKairoEncodingId(label);
  return KAIRO_TO_THEIA_ENCODING[kairo] ?? kairo;
}

/** Theia id → Kairo id (alias of toKairoEncodingId for call-site clarity). */
export function fromTheiaEncodingId(id: string): string {
  return toKairoEncodingId(id);
}

/** Domain-safe equality: 'utf-8' === 'utf8' === 'UTF8'. */
export function sameEncodingId(a: string, b: string): boolean {
  return toKairoEncodingId(a) === toKairoEncodingId(b);
}
