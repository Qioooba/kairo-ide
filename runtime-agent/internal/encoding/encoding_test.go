package encoding

import (
	"bytes"
	"strings"
	"testing"
)

func TestDetect_BOM(t *testing.T) {
	cases := []struct {
		name string
		bom  []byte
		want ID
	}{
		{"utf-8", []byte{0xEF, 0xBB, 0xBF}, UTF8BOM},
		{"utf-16le", []byte{0xFF, 0xFE}, UTF16LE},
		{"utf-16be", []byte{0xFE, 0xFF}, UTF16BE},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, _, hasBom, _ := Detect(append(c.bom, 'a', 'b', 'c'), UTF8, Aliases{})
			if got != c.want {
				t.Errorf("got %q, want %q", got, c.want)
			}
			if !hasBom {
				t.Errorf("expected hasBom=true")
			}
		})
	}
}

func TestDetect_PureASCII(t *testing.T) {
	got, conf, _, _ := Detect([]byte("hello world\n"), UTF8, Aliases{})
	if got != UTF8 {
		t.Errorf("got %q, want utf-8", got)
	}
	if conf < 0.5 {
		t.Errorf("confidence too low: %f", conf)
	}
}

func TestDetect_GBK(t *testing.T) {
	// "你好" in GBK: 0xC4 0xE3 0xBA 0xC3
	gbk := []byte{0xC4, 0xE3, 0xBA, 0xC3}
	got, _, _, _ := Detect(gbk, GBK, Aliases{})
	if got != GB18030 && got != GBK {
		t.Errorf("got %q, want gbk/gb18030", got)
	}
}

func TestDetect_UTF8WithMultibyte(t *testing.T) {
	// "你好" in UTF-8: E4 BD A0 E5 A5 BD
	utf8bytes := []byte("你好，世界")
	got, conf, _, _ := Detect(utf8bytes, GBK, Aliases{})
	if got != UTF8 {
		t.Errorf("got %q, want utf-8 (confidence %f)", got, conf)
	}
}

func TestEOL(t *testing.T) {
	cases := []struct {
		eol  string
		data []byte
	}{
		{"lf", []byte("a\nb\nc\n")},
		{"crlf", []byte("a\r\nb\r\nc\r\n")},
		{"cr", []byte("a\rb\rc\r")},
	}
	for _, c := range cases {
		if got := detectEOL(c.data); got != c.eol {
			t.Errorf("got %q, want %q", got, c.eol)
		}
	}
}

func TestEncodeDecodeRoundTrip(t *testing.T) {
	original := "你好，World!"
	encoded, err := Encode([]byte(original), GBK, Aliases{})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.HasPrefix(encoded, []byte{0xEF, 0xBB, 0xBF}) {
		t.Errorf("GBK should not have BOM")
	}
	decoded, err := Decode(encoded, GBK, Aliases{})
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != original {
		t.Errorf("roundtrip: got %q, want %q", string(decoded), original)
	}
}

func TestEncode_GBKUnrepresentable(t *testing.T) {
	// GBK cannot represent emoji — encode must fail (strict GBK),
	// not silently succeed via the GB18030 superset.
	if _, err := Encode([]byte("你好 🔥"), GBK, Aliases{}); err == nil {
		t.Errorf("GBK encode of emoji should fail")
	}
	// The same text must still encode under GB18030.
	if _, err := Encode([]byte("你好 🔥"), GB18030, Aliases{}); err != nil {
		t.Errorf("GB18030 encode of emoji should succeed: %v", err)
	}
	// Pure GBK-representable text still encodes fine.
	if _, err := Encode([]byte("你好"), GBK, Aliases{}); err != nil {
		t.Errorf("GBK encode of Chinese text should succeed: %v", err)
	}
	// Decoding GBK bytes keeps using the GB18030 superset.
	gbkBytes, err := Encode([]byte("你好"), GBK, Aliases{})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := Decode(gbkBytes, GBK, Aliases{})
	if err != nil || string(decoded) != "你好" {
		t.Errorf("GBK decode roundtrip: got %q, err=%v", string(decoded), err)
	}
}

func TestPropertiesEncode(t *testing.T) {
	in := []byte("hello=\u4f60\u597d") // 你好
	out, err := PropertiesEncode(in)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), `hello=\u4F60\u597D`) {
		// \uXXXX uppercase form; we may have to accept lowercase.
		// Be lenient.
		if !strings.Contains(string(out), `hello=\u4f60\u597d`) {
			t.Errorf("expected escapes, got %q", string(out))
		}
	}
}
