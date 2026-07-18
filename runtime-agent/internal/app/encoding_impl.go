package app

import (
	"context"
	"fmt"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// EncodingService provides server-side encoding validation and
// detection. Unlike the browser TextEncoder (which only supports
// UTF-8), this service uses golang.org/x/text to perform real
// round-trip encoding checks for GBK, ISO-8859-1, Shift_JIS, etc.
type EncodingService struct{}

// NewEncodingService returns a new EncodingService.
func NewEncodingService() *EncodingService {
	return &EncodingService{}
}

// ValidateEncoding checks if the given UTF-8 text can be represented
// in the target encoding. Returns an error with the first
// unrepresentable character if not.
func (s *EncodingService) ValidateEncoding(ctx context.Context, utf8Text string, targetEncoding string) error {
	enc := getEncoding(targetEncoding)
	if enc == nil {
		return fmt.Errorf("unsupported encoding: %s", targetEncoding)
	}
	encoder := enc.NewEncoder()
	_, _, err := transform.String(encoder, utf8Text)
	if err != nil {
		return fmt.Errorf("text cannot be represented in %s: %w", targetEncoding, err)
	}
	return nil
}

// DetectEncoding detects the most likely encoding of byte data.
// Priority: BOM → project default → UTF-8 heuristic → GBK fallback.
func (s *EncodingService) DetectEncoding(data []byte, projectDefault string) string {
	// Check BOM
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		return "UTF-8"
	}
	if len(data) >= 2 && data[0] == 0xFE && data[1] == 0xFF {
		return "UTF-16BE"
	}
	if len(data) >= 2 && data[0] == 0xFF && data[1] == 0xFE {
		return "UTF-16LE"
	}

	// If project default is set, use it
	if projectDefault != "" {
		return projectDefault
	}

	// Heuristic: check if data is valid UTF-8
	if isValidUTF8(data) {
		return "UTF-8"
	}

	// Default to GBK for Chinese legacy projects
	return "GBK"
}

func isValidUTF8(data []byte) bool {
	i := 0
	for i < len(data) {
		if data[i] < 0x80 {
			i++
			continue
		}
		// Check multi-byte sequence
		var n int
		if data[i] >= 0xF0 {
			n = 4
		} else if data[i] >= 0xE0 {
			n = 3
		} else if data[i] >= 0xC0 {
			n = 2
		} else {
			return false
		}

		if i+n > len(data) {
			return false
		}
		for j := 1; j < n; j++ {
			if data[i+j]&0xC0 != 0x80 {
				return false
			}
		}
		i += n
	}
	return true
}

func getEncoding(name string) encoding.Encoding {
	switch name {
	case "GBK", "GB18030":
		return simplifiedchinese.GBK
	case "GB2312":
		return simplifiedchinese.HZGB2312
	case "Big5":
		return traditionalchinese.Big5
	case "Shift_JIS", "SJIS":
		return japanese.ShiftJIS
	case "EUC-JP":
		return japanese.EUCJP
	case "ISO-8859-1", "Latin1":
		return charmap.ISO8859_1
	case "UTF-8":
		return unicode.UTF8
	case "UTF-16":
		return unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM)
	default:
		return nil
	}
}