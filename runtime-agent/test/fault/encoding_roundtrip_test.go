//go:build fault
// +build fault

package fault

import (
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/encoding"
)

func TestGBKRoundTrip(t *testing.T) {
	// Test full GBK → UTF-8 → GBK round-trip using the package-level
	// Encode and Decode functions.
	testCases := []string{
		"Hello World",
		"你好世界",
		"日本語",
		"混合English和中文",
	}

	for _, tc := range testCases {
		gbkBytes, err := encoding.Encode([]byte(tc), encoding.GBK, encoding.Aliases{})
		if err != nil {
			t.Errorf("GBK encode failed for '%s': %v", tc, err)
			continue
		}
		utf8Result, err := encoding.Decode(gbkBytes, encoding.GBK, encoding.Aliases{})
		if err != nil {
			t.Errorf("GBK decode failed for '%s': %v", tc, err)
			continue
		}
		if string(utf8Result) != tc {
			t.Errorf("round-trip mismatch: expected '%s', got '%s'", tc, string(utf8Result))
		}
	}
}

func TestUTF8BOMRoundTrip(t *testing.T) {
	// Encode with UTF-8 BOM and verify the BOM is present, then decode
	// and verify the content.
	original := "Hello, 你好"
	encoded, err := encoding.Encode([]byte(original), encoding.UTF8BOM, encoding.Aliases{})
	if err != nil {
		t.Fatalf("UTF8BOM encode: %v", err)
	}

	// BOM should be present: EF BB BF
	if len(encoded) < 3 || encoded[0] != 0xEF || encoded[1] != 0xBB || encoded[2] != 0xBF {
		t.Errorf("UTF-8-BOM should start with EF BB BF, got %x", encoded[:min(3, len(encoded))])
	}

	// Decode should strip BOM and return the original content
	decoded, err := encoding.Decode(encoded, encoding.UTF8BOM, encoding.Aliases{})
	if err != nil {
		t.Fatalf("UTF8BOM decode: %v", err)
	}
	if string(decoded) != original {
		t.Errorf("UTF-8-BOM round-trip: expected '%s', got '%s'", original, string(decoded))
	}
}

func TestEncodingRejectInvalid(t *testing.T) {
	// Encode Chinese characters to ISO-8859-1 (Latin-1), which cannot
	// represent them. This should return an error.
	_, err := encoding.Encode([]byte("你好"), encoding.ISO88591, encoding.Aliases{})
	if err == nil {
		t.Fatal("should have rejected encoding Chinese characters to ISO-8859-1")
	}
}

func TestEncodingRejectUnknownEncoding(t *testing.T) {
	// Test that unknown encoding IDs are rejected
	_, err := encoding.Encode([]byte("hello"), "bogus-encoding", encoding.Aliases{})
	if err == nil {
		t.Fatal("should have rejected unknown encoding for Encode")
	}
	_, err = encoding.Decode([]byte("hello"), "bogus-encoding", encoding.Aliases{})
	if err == nil {
		t.Fatal("should have rejected unknown encoding for Decode")
	}
}

func TestDetectGBKContent(t *testing.T) {
	// "你好" in GBK: 0xC4 0xE3 0xBA 0xC3
	gbk := []byte{0xC4, 0xE3, 0xBA, 0xC3}
	got, _, _, _ := encoding.Detect(gbk, encoding.GBK, encoding.Aliases{})
	if got != encoding.GB18030 && got != encoding.GBK {
		t.Errorf("got %q, want gbk or gb18030", got)
	}
}

func TestDetectUTF8WithMultibyte(t *testing.T) {
	// "你好" in UTF-8: E4 BD A0 E5 A5 BD
	utf8bytes := []byte("你好，世界")
	got, conf, _, _ := encoding.Detect(utf8bytes, encoding.GBK, encoding.Aliases{})
	if got != encoding.UTF8 {
		t.Errorf("got %q, want utf-8 (confidence %f)", got, conf)
	}
}

func TestDetectBOM(t *testing.T) {
	// UTF-8 BOM + "abc"
	sample := append([]byte{0xEF, 0xBB, 0xBF}, []byte("abc")...)
	got, _, hasBom, _ := encoding.Detect(sample, encoding.UTF8, encoding.Aliases{})
	if got != encoding.UTF8BOM {
		t.Errorf("got %q, want utf-8-bom", got)
	}
	if !hasBom {
		t.Error("expected hasBom=true")
	}
}
