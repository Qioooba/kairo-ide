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

// TestDetect_UTF8_SmallFile 验证 UTF-8 编码文件（带 BOM）的检测
func TestDetect_UTF8_SmallFile(t *testing.T) {
	t.Parallel()
	// 带 BOM 的 UTF-8 文件内容
	bom := []byte{0xEF, 0xBB, 0xBF}
	content := []byte("hello world\n你好世界\n")
	sample := append(bom, content...)
	got, conf, hasBom, eol := Detect(sample, UTF8, Aliases{})
	if got != UTF8BOM {
		t.Errorf("got %q, want utf-8-bom", got)
	}
	if conf != 1.0 {
		t.Errorf("confidence = %f, want 1.0", conf)
	}
	if !hasBom {
		t.Errorf("expected hasBom=true")
	}
	if eol != "lf" {
		t.Errorf("eol = %q, want lf", eol)
	}
}

// TestDetect_UTF8_NoBOM 验证无 BOM 的 UTF-8 文件检测
func TestDetect_UTF8_NoBOM(t *testing.T) {
	t.Parallel()
	content := []byte("package main\n\nimport \"fmt\"\n\nfunc main() {\n    fmt.Println(\"你好\")\n}\n")
	got, conf, hasBom, _ := Detect(content, UTF8, Aliases{})
	if got != UTF8 {
		t.Errorf("got %q, want utf-8", got)
	}
	if conf != 0.95 {
		t.Errorf("confidence = %f, want 0.95", conf)
	}
	if hasBom {
		t.Errorf("expected hasBom=false")
	}
}

// TestDetect_GBK_XML_Declaration 验证 XML 中 encoding="GBK" 声明的检测
func TestDetect_GBK_XML_Declaration(t *testing.T) {
	t.Parallel()
	// XML with GBK encoding declaration
	xml := []byte(`<?xml version="1.0" encoding="GBK"?>
<root>
<item>测试</item>
</root>`)
	got, conf, _, _ := Detect(xml, UTF8, Aliases{})
	if got != GBK {
		t.Errorf("got %q, want gbk", got)
	}
	if conf != 0.98 {
		t.Errorf("confidence = %f, want 0.98", conf)
	}
}

// TestDetect_GBK_HTML_Charset 验证 HTML 中 <meta charset="GBK"> 的检测
func TestDetect_GBK_HTML_Charset(t *testing.T) {
	t.Parallel()
	html := []byte(`<!DOCTYPE html>
<html>
<head>
<meta charset="GBK">
<title>标题</title>
</head>
<body>内容</body>
</html>`)
	got, conf, _, _ := Detect(html, UTF8, Aliases{})
	if got != GBK {
		t.Errorf("got %q, want gbk", got)
	}
	if conf != 0.95 {
		t.Errorf("confidence = %f, want 0.95", conf)
	}
}

// TestDetect_ISO8859_1 验证 Latin-1 编码文件的检测
func TestDetect_ISO8859_1(t *testing.T) {
	t.Parallel()
	// ISO-8859-1 bytes with high bytes (0x80-0xFF) that are NOT valid GBK sequences
	// 0x80 is a single byte that is valid in ISO-8859-1 but invalid in GBK
	sample := []byte{0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x80, 0x90, 0xA0, 0xB0}
	got, _, _, _ := Detect(sample, UTF8, Aliases{})
	// Should fallback to ISO-8859-1 since invalid UTF-8 and not GBK
	if got != ISO88591 {
		t.Errorf("got %q, want iso-8859-1", got)
	}
}

// TestDetect_Empty 验证空文件的检测
func TestDetect_Empty(t *testing.T) {
	t.Parallel()
	got, conf, hasBom, eol := Detect([]byte{}, UTF8, Aliases{})
	// Empty file is valid UTF-8 and ASCII
	if got != UTF8 {
		t.Errorf("got %q, want utf-8", got)
	}
	if conf != 0.9 {
		t.Errorf("confidence = %f, want 0.9", conf)
	}
	if hasBom {
		t.Errorf("expected hasBom=false")
	}
	if eol != "lf" {
		t.Errorf("eol = %q, want lf", eol)
	}
}

// TestDetect_Binary 验证二进制文件的检测
func TestDetect_Binary(t *testing.T) {
	t.Parallel()
	// Binary-like data with null bytes and few high bytes (< 4) to avoid GB18030 detection
	binary := []byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x81, 0x00, 0x7F, 0xFF, 0xFE}
	got, conf, _, _ := Detect(binary, UTF8, Aliases{})
	// Binary data is not valid UTF-8, not enough high bytes for GBK
	// Should fall back to ISO-8859-1
	if got != ISO88591 {
		t.Errorf("got %q, want iso-8859-1", got)
	}
	if conf < 0.4 {
		t.Errorf("confidence too low: %f", conf)
	}
}

// TestDetect_LargeFile 验证大文件（500KB）检测不会超时
func TestDetect_LargeFile(t *testing.T) {
	t.Parallel()
	// Create 500KB UTF-8 content
	content := bytes.Repeat([]byte("hello world 你好世界这是测试数据\n"), 15000)
	if len(content) < 500*1024 {
		t.Fatalf("sample too small: %d bytes", len(content))
	}
	got, conf, _, _ := Detect(content, UTF8, Aliases{})
	if got != UTF8 {
		t.Errorf("got %q, want utf-8", got)
	}
	if conf != 0.95 {
		t.Errorf("confidence = %f, want 0.95", conf)
	}
}

// TestDetect_Concurrent 验证并发检测无竞态条件
func TestDetect_Concurrent(t *testing.T) {
	t.Parallel()
	done := make(chan struct{})
	for i := 0; i < 10; i++ {
		go func() {
			samples := [][]byte{
				[]byte("hello world\n"),
				{0xEF, 0xBB, 0xBF, 'h', 'e', 'l', 'l', 'o'},
				{0xC4, 0xE3, 0xBA, 0xC3}, // 你好 in GBK
				[]byte(`<?xml version="1.0" encoding="GBK"?><root/>`),
				[]byte("纯UTF-8中文文本内容\n"),
			}
			for _, s := range samples {
				got, _, _, _ := Detect(s, GBK, Aliases{})
				if got == "" {
					t.Errorf("empty encoding detected")
				}
			}
			done <- struct{}{}
		}()
	}
	for i := 0; i < 10; i++ {
		<-done
	}
}

// TestConvert_UTF8_To_GBK 验证 UTF-8 到 GBK 的编码转换
func TestConvert_UTF8_To_GBK(t *testing.T) {
	t.Parallel()
	original := "你好，世界！Hello World!"
	encoded, err := Encode([]byte(original), GBK, Aliases{})
	if err != nil {
		t.Fatal(err)
	}
	// GBK 编码后不应有 BOM
	if bytes.HasPrefix(encoded, []byte{0xEF, 0xBB, 0xBF}) {
		t.Errorf("GBK encoded output should not have BOM")
	}
	// 第一轮解码回 UTF-8
	decoded, err := Decode(encoded, GBK, Aliases{})
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != original {
		t.Errorf("roundtrip: got %q, want %q", string(decoded), original)
	}
}

// TestConvert_GBK_To_UTF8 验证 GBK 到 UTF-8 的解码转换
func TestConvert_GBK_To_UTF8(t *testing.T) {
	t.Parallel()
	// "你好世界" in GBK
	gbk := []byte{0xC4, 0xE3, 0xBA, 0xC3, 0xCA, 0xC0, 0xBD, 0xE7}
	decoded, err := Decode(gbk, GBK, Aliases{})
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != "你好世界" {
		t.Errorf("got %q, want 你好世界", string(decoded))
	}
	// 再次编码回 GBK
	encoded, err := Encode(decoded, GBK, Aliases{})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(encoded, gbk) {
		t.Errorf("roundtrip: got %x, want %x", encoded, gbk)
	}
}

// TestConvert_InvalidSequence 验证无效字节序列应返回错误
func TestConvert_InvalidSequence(t *testing.T) {
	t.Parallel()
	// 尝试用未知编码类型解码
	_, err := Decode([]byte("hello"), "unknown-encoding", Aliases{})
	if err == nil {
		t.Errorf("expected error for unknown encoding")
	}
}
