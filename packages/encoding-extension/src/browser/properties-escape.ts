/**
 * Java .properties file escape handling.
 *
 * Java 6 .properties files use ISO-8859-1 encoding. Characters
 * outside Latin-1 are represented as \\uXXXX escape sequences.
 * Supplementary-plane characters (rune > U+FFFF) use surrogate
 * pairs: \\uD800\\uDC00.
 *
 * Whole-file encode/decode is also implemented here so Theia
 * FileService saves (Ctrl+S) emit ISO-8859-1 + \\uXXXX without
 * waiting on the agent recode endpoint. The Go PropertiesEncode
 * helper remains the source of truth for agent-side recode.
 */

const HEX = '0123456789ABCDEF';

function hex4(code: number): string {
    return HEX[(code >> 12) & 0xF]
        + HEX[(code >> 8) & 0xF]
        + HEX[(code >> 4) & 0xF]
        + HEX[code & 0xF];
}

/** True for *.properties URIs / fs paths (query/hash stripped). */
export function isPropertiesPath(pathOrUri: string): boolean {
    const normalized = pathOrUri.split('?')[0].split('#')[0].toLowerCase();
    return normalized.endsWith('.properties');
}

/**
 * Convert Unicode text to Java native2ascii form.
 * Code points < U+0080 pass through (so existing \\uXXXX sequences
 * are not double-escaped). BMP chars become \\uXXXX; supplementary
 * plane chars become a UTF-16 surrogate pair, matching Java Properties.
 */
export function escapeProperties(text: string): string {
    let result = '';
    for (const char of text) {
        const cp = char.codePointAt(0)!;
        if (cp < 0x80) {
            result += char;
            continue;
        }
        if (cp > 0xFFFF) {
            const r = cp - 0x10000;
            const hi = 0xD800 + (r >> 10);
            const lo = 0xDC00 + (r & 0x3FF);
            result += `\\u${hex4(hi)}\\u${hex4(lo)}`;
            continue;
        }
        result += `\\u${hex4(cp)}`;
    }
    return result;
}

/**
 * Convert Java \\uXXXX escape sequences to actual Unicode characters.
 * Also handles \\n, \\r, \\t, \\\\, \\:, \\=, \\#, \\! escapes.
 */
export function unescapeProperties(text: string): string {
    let result = '';
    let i = 0;
    while (i < text.length) {
        if (text[i] === '\\' && i + 1 < text.length) {
            const next = text[i + 1];
            switch (next) {
                case 'u':
                    // Parse \uXXXX escape (exactly 4 hex digits)
                    if (i + 5 < text.length) {
                        const hex = text.substring(i + 2, i + 6);
                        if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
                            const cp = parseInt(hex, 16);
                            // Check for surrogate pair
                            if (cp >= 0xD800 && cp <= 0xDBFF && i + 11 < text.length && text[i + 6] === '\\' && text[i + 7] === 'u') {
                                const loHex = text.substring(i + 8, i + 12);
                                if (/^[0-9A-Fa-f]{4}$/.test(loHex)) {
                                    const lo = parseInt(loHex, 16);
                                    if (lo >= 0xDC00 && lo <= 0xDFFF) {
                                        const hi = cp - 0xD800;
                                        const surr = (hi << 10) + (lo - 0xDC00) + 0x10000;
                                        result += String.fromCodePoint(surr);
                                        i += 12;
                                        continue;
                                    }
                                }
                            }
                            result += String.fromCharCode(cp);
                            i += 6;
                            continue;
                        }
                    }
                    result += '\\u';
                    i += 2;
                    continue;
                case 'n':
                    result += '\n';
                    i += 2;
                    continue;
                case 'r':
                    result += '\r';
                    i += 2;
                    continue;
                case 't':
                    result += '\t';
                    i += 2;
                    continue;
                case '\\':
                    result += '\\';
                    i += 2;
                    continue;
                case ':':
                    result += ':';
                    i += 2;
                    continue;
                case '=':
                    result += '=';
                    i += 2;
                    continue;
                case '#':
                    result += '#';
                    i += 2;
                    continue;
                case '!':
                    result += '!';
                    i += 2;
                    continue;
                default:
                    // Unrecognized escape — keep as-is
                    result += text[i];
                    i++;
                    continue;
            }
        }
        result += text[i];
        i++;
    }
    return result;
}