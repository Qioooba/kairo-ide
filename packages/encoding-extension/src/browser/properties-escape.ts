/**
 * Java .properties file escape handling.
 *
 * Java 6 .properties files use ISO-8859-1 encoding. Characters
 * outside Latin-1 are represented as \\uXXXX escape sequences.
 * Supplementary-plane characters (rune > U+FFFF) use surrogate
 * pairs: \\uD800\\uDC00.
 *
 * This module provides round-trip support:
 *   unescape → edit → re-escape on save
 *
 * The Go agent handles the byte-level read/write (PropertiesDecode
 * / PropertiesEncode in internal/encoding/encoding.go). This module
 * handles the editor-level view, so the user sees real Unicode
 * characters in the editor but the file bytes stay ISO-8859-1 safe.
 */

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

/**
 * Convert non-ASCII characters to Java \\uXXXX escape sequences.
 * ASCII characters (0x00-0x7F) are kept as-is, except for the
 * characters that have special meaning in .properties files:
 * \\, :, =, #, ! which are always escaped.
 *
 * Supplementary-plane characters (rune > U+FFFF) are emitted as
 * UTF-16 surrogate pairs (\\uD800\\uDC00), matching the Java
 * Properties spec.
 */
export function escapeProperties(text: string): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const cp = text.codePointAt(i);
        if (cp === undefined) continue;

        if (cp < 0x80) {
            // ASCII: escape special .properties characters
            switch (cp) {
                case 0x09: // tab
                    result += '\\t';
                    break;
                case 0x0A: // newline
                    result += '\\n';
                    break;
                case 0x0D: // carriage return
                    result += '\\r';
                    break;
                case 0x5C: // backslash
                    result += '\\\\';
                    break;
                case 0x3A: // colon
                    result += '\\:';
                    break;
                case 0x3D: // equals
                    result += '\\=';
                    break;
                case 0x23: // hash
                    result += '\\#';
                    break;
                case 0x21: // exclamation
                    result += '\\!';
                    break;
                default:
                    result += String.fromCharCode(cp);
                    break;
            }
        } else if (cp > 0xFFFF) {
            // Supplementary plane: emit surrogate pair
            const surr = cp - 0x10000;
            const hi = 0xD800 + (surr >> 10);
            const lo = 0xDC00 + (surr & 0x3FF);
            result += '\\u' + hex4(hi) + '\\u' + hex4(lo);
            i++; // skip the low surrogate (codePointAt advances past it but we need to skip)
        } else {
            // BMP non-ASCII: emit \uXXXX
            result += '\\u' + hex4(cp);
        }
    }
    return result;
}

function hex4(v: number): string {
    return v.toString(16).toUpperCase().padStart(4, '0');
}