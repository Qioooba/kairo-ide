// Package encoding detects and handles text file encodings.
// See docs/adr/0007-encoding-handling.md.
//
// We support: utf-8, utf-8-bom, utf-16le, utf-16be, gbk,
// gb18030, iso-8859-1, us-ascii. We do not try to be a complete
// encoding detector — we focus on the legacy Chinese project
// mix that is the product's primary use case.
package encoding

import (
	"bytes"
	"errors"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/korean"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// ID is a stable encoding identifier.
type ID = string

const (
	UTF8     ID = "utf-8"
	UTF8BOM  ID = "utf-8-bom"
	UTF16LE  ID = "utf-16le"
	UTF16BE  ID = "utf-16be"
	GBK      ID = "gbk"
	GB18030  ID = "gb18030"
	ISO88591 ID = "iso-8859-1"
	USASCII  ID = "us-ascii"
)

// Aliases maps user-registered aliases to canonical IDs.
type Aliases struct {
	M map[string]ID
}

// Resolve returns the canonical ID for an alias, or the input
// if it is already canonical.
func (a Aliases) Resolve(id ID) ID {
	if a.M == nil {
		return id
	}
	if v, ok := a.M[strings.ToLower(id)]; ok {
		return v
	}
	return id
}

// Detect returns the most likely encoding for a sample.
// `defaultEnc` is the project default (e.g. "gbk"). It is used
// when the sample is small or ambiguous.
//
// The result is a (encoding, confidence, hasBom, eol) tuple.
// hasBom is true if a BOM was present and used to decide.
func Detect(sample []byte, defaultEnc ID, aliases Aliases) (id ID, confidence float64, hasBom bool, eol string) {
	// 1. BOM is the strongest signal.
	if len(sample) >= 3 && sample[0] == 0xEF && sample[1] == 0xBB && sample[2] == 0xBF {
		return UTF8BOM, 1.0, true, detectEOL(sample[3:])
	}
	if len(sample) >= 2 {
		if sample[0] == 0xFF && sample[1] == 0xFE {
			return UTF16LE, 1.0, true, detectEOL(sample[2:])
		}
		if sample[0] == 0xFE && sample[1] == 0xFF {
			return UTF16BE, 1.0, true, detectEOL(sample[2:])
		}
	}

	// 2. Valid UTF-8?
	if utf8.Valid(sample) {
		// Distinguish pure ASCII from UTF-8.
		if isASCII(sample) {
			// Pick defaultEnc if it's not utf-8 / us-ascii / iso-8859-1.
			switch aliases.Resolve(defaultEnc) {
			case UTF8, USASCII, ISO88591:
				return UTF8, 0.9, false, detectEOL(sample)
			default:
				// The project says GBK; we have valid UTF-8 too.
				// Trust the project default slightly.
				return defaultEnc, 0.55, false, detectEOL(sample)
			}
		}
		return UTF8, 0.95, false, detectEOL(sample)
	}

	// 3. Try GB18030 (superset of GBK and GB2312). High chance for
	// Chinese legacy content.
	rest := sample
	if len(rest) > 8192 {
		rest = rest[:8192]
	}
	if isGB18030(rest) {
		return GB18030, 0.9, false, detectEOL(sample)
	}

	// 4. Fall back to defaultEnc ONLY if the sample is actually
	// decodable as that encoding. Without this guard, an
	// invalid-UTF-8 sample with defaultEnc=utf-8 would lie and
	// return utf-8 — which is exactly the false-positive the
	// integration test surfaced.
	if canDecodeAs(sample, aliases.Resolve(defaultEnc)) {
		return defaultEnc, 0.6, false, detectEOL(sample)
	}

	// 5. iso-8859-1 never errors. Last resort.
	return ISO88591, 0.5, false, detectEOL(sample)
}

func detectEOL(b []byte) string {
	// Look at the first ~4KB for the most common line ending.
	limit := len(b)
	if limit > 4096 {
		limit = 4096
	}
	crlf, lf, cr := 0, 0, 0
	for i := 0; i < limit; i++ {
		switch b[i] {
		case '\n':
			if i > 0 && b[i-1] == '\r' {
				crlf++
			} else {
				lf++
			}
		case '\r':
			if i+1 < limit && b[i+1] == '\n' {
				// counted as part of CRLF above
			} else {
				cr++
			}
		}
	}
	switch {
	case crlf >= lf && crlf >= cr && crlf > 0:
		return "crlf"
	case cr > lf && cr > 0:
		return "cr"
	case lf > 0:
		return "lf"
	default:
		return "lf"
	}
}

func isASCII(b []byte) bool {
	for _, c := range b {
		if c > 0x7F {
			return false
		}
	}
	return true
}

// canDecodeAs returns true if `b` decodes successfully under
// the given encoding ID. We use this to refuse to claim an
// encoding the bytes do not actually fit.
//
// Special case: utf-8 is checked with utf8.Valid, not the
// encoding decoder, because the unicode.UTF8 decoder does
// not error on invalid bytes — it replaces them with U+FFFD.
// Using utf8.Valid is the truthful "these bytes are valid
// UTF-8" check.
func canDecodeAs(b []byte, id ID) bool {
	switch id {
	case UTF8, USASCII:
		return utf8.Valid(b)
	default:
		enc := Encoder(id, Aliases{})
		if enc == nil {
			return false
		}
		_, _, err := transform.Bytes(enc.NewDecoder(), b)
		return err == nil
	}
}

// isGB18030 returns true if the sample can be decoded as GB18030
// without error and contains at least one double-byte sequence.
func isGB18030(b []byte) bool {
	// Cheap heuristic first: high-byte density.
	high := 0
	for _, c := range b {
		if c >= 0x81 {
			high++
		}
	}
	if high < 4 {
		return false
	}
	dec := simplifiedchinese.GB18030.NewDecoder()
	out, _, err := transform.Bytes(dec, b)
	if err != nil {
		return false
	}
	// If we have double-byte sequences, gb18030 wins.
	hasDouble := false
	for _, c := range b {
		if c >= 0x81 {
			hasDouble = true
			break
		}
	}
	_ = out
	return hasDouble && err == nil
}

// Encoder returns an encoding.Encoder for the given ID, or nil
// if the ID is unknown.
func Encoder(id ID, aliases Aliases) encoding.Encoding {
	id = ID(strings.ToLower(string(aliases.Resolve(id))))
	switch id {
	case UTF8, UTF8BOM, USASCII:
		return unicode.UTF8
	case UTF16LE:
		return unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM)
	case UTF16BE:
		return unicode.UTF16(unicode.BigEndian, unicode.IgnoreBOM)
	case GBK, GB18030:
		return simplifiedchinese.GB18030
	case ISO88591:
		return charmap.ISO8859_1
	case "shift_jis":
		return japanese.ShiftJIS
	case "euc-jp":
		return japanese.EUCJP
	case "euc-kr":
		return korean.EUCKR
	case "big5":
		return traditionalchinese.Big5
	}
	return nil
}

// Decode decodes src using the given encoding. If id is unknown,
// the input is returned unchanged with an error.
func Decode(src []byte, id ID, aliases Aliases) ([]byte, error) {
	id = ID(strings.ToLower(string(id)))
	enc := Encoder(id, aliases)
	if enc == nil {
		return nil, errors.New("unknown encoding: " + id)
	}
	// Strip BOM if present.
	src = stripBOM(src, id)
	dec := enc.NewDecoder()
	out, _, err := transform.Bytes(dec, src)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Encode encodes src using the given encoding.
func Encode(src []byte, id ID, aliases Aliases) ([]byte, error) {
	id = ID(strings.ToLower(string(id)))
	enc := Encoder(id, aliases)
	// GBK encode must be strict: GB18030 (the decode choice, a
	// superset) can encode any Unicode rune, which would let
	// unrepresentable characters (e.g. emoji) silently pass
	// validation and corrupt the file on save. Strict GBK
	// returns a RepertoireError for such runes.
	if ID(strings.ToLower(string(aliases.Resolve(id)))) == GBK {
		enc = simplifiedchinese.GBK
	}
	if enc == nil {
		return nil, errors.New("unknown encoding: " + id)
	}
	out, err := ioBytes(enc.NewEncoder(), src)
	if err != nil {
		return nil, err
	}
	if id == UTF8BOM {
		out = append([]byte{0xEF, 0xBB, 0xBF}, out...)
	}
	return out, nil
}

func ioBytes(w transform.Transformer, src []byte) ([]byte, error) {
	var buf bytes.Buffer
	bw := transform.NewWriter(&buf, w)
	if _, err := bw.Write(src); err != nil {
		return nil, err
	}
	if err := bw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func stripBOM(b []byte, id ID) []byte {
	switch id {
	case UTF8, UTF8BOM:
		if len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF {
			return b[3:]
		}
	case UTF16LE:
		if len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE {
			return b[2:]
		}
	case UTF16BE:
		if len(b) >= 2 && b[0] == 0xFE && b[1] == 0xFF {
			return b[2:]
		}
	}
	return b
}

// PropertiesDecode converts an ISO-8859-1 bytes (with \uXXXX
// escapes preserved) into UTF-8 for editor display. It does NOT
// alter the on-disk bytes; only the in-memory view.
func PropertiesDecode(src []byte) ([]byte, error) {
	dec := charmap.ISO8859_1.NewDecoder()
	out, _, err := transform.Bytes(dec, src)
	return out, err
}

// PropertiesEncode converts UTF-8 text to the ISO-8859-1-with-
// escapes form for *.properties saving.
//
// Characters outside the Basic Multilingual Plane (rune > U+FFFF,
// e.g. emoji or CJK Extension B) are emitted as a UTF-16 surrogate
// pair, exactly as the Java Properties spec requires. Casting such
// a rune to uint16 silently truncates it, corrupting the file.
func PropertiesEncode(src []byte) ([]byte, error) {
	// We do not use the charmap encoder because that loses chars;
	// we need the \uXXXX escape form.
	var out bytes.Buffer
	for _, r := range string(src) {
		if r < 0x80 {
			out.WriteRune(r)
			continue
		}
		if r > 0xFFFF {
			// Supplementary plane: emit a UTF-16 surrogate pair.
			r -= 0x10000
			hi := 0xD800 + (r >> 10)
			lo := 0xDC00 + (r & 0x3FF)
			out.WriteString(`\u`)
			writeHex4(&out, uint16(hi))
			out.WriteString(`\u`)
			writeHex4(&out, uint16(lo))
			continue
		}
		out.WriteString(`\u`)
		writeHex4(&out, uint16(r))
	}
	return out.Bytes(), nil
}

func writeHex4(b *bytes.Buffer, v uint16) {
	const hex = "0123456789ABCDEF"
	b.WriteByte(hex[(v>>12)&0xF])
	b.WriteByte(hex[(v>>8)&0xF])
	b.WriteByte(hex[(v>>4)&0xF])
	b.WriteByte(hex[v&0xF])
}
