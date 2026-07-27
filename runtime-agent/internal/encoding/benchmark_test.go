package encoding

import (
	"bytes"
	"testing"
)

func BenchmarkDetect_UTF8(b *testing.B) {
	sample := []byte("hello world\npackage main\n\nimport \"fmt\"\n\nfunc main() {\n    fmt.Println(\"你好\")\n}\n")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Detect(sample, UTF8, Aliases{})
	}
}

func BenchmarkDetect_BOM(b *testing.B) {
	bom := []byte{0xEF, 0xBB, 0xBF}
	sample := append(bom, []byte("hello world\n你好世界\n")...)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Detect(sample, UTF8, Aliases{})
	}
}

func BenchmarkDetect_GBK(b *testing.B) {
	gbk := []byte{0xC4, 0xE3, 0xBA, 0xC3}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Detect(gbk, GBK, Aliases{})
	}
}

func BenchmarkDetect_XML_Declaration(b *testing.B) {
	xml := []byte(`<?xml version="1.0" encoding="GBK"?>
<root>
<item>测试</item>
</root>`)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Detect(xml, UTF8, Aliases{})
	}
}

func BenchmarkDetect_HTML_Charset(b *testing.B) {
	html := []byte(`<!DOCTYPE html>
<html>
<head>
<meta charset="GBK">
<title>标题</title>
</head>
<body>内容</body>
</html>`)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Detect(html, UTF8, Aliases{})
	}
}

func BenchmarkDetect_LargeFile(b *testing.B) {
	large := bytes.Repeat([]byte("hello world 你好世界这是测试数据\n"), 15000)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Detect(large, UTF8, Aliases{})
	}
}

func BenchmarkDetect_ASCII(b *testing.B) {
	sample := []byte("hello world\n")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Detect(sample, UTF8, Aliases{})
	}
}

func BenchmarkEncode_GBK(b *testing.B) {
	original := []byte("你好，世界！Hello World!")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Encode(original, GBK, Aliases{})
	}
}

func BenchmarkDecode_GBK(b *testing.B) {
	gbk := []byte{0xC4, 0xE3, 0xBA, 0xC3, 0xCA, 0xC0, 0xBD, 0xE7}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Decode(gbk, GBK, Aliases{})
	}
}

func BenchmarkEncode_UTF8BOM(b *testing.B) {
	original := []byte("hello world\n")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Encode(original, UTF8BOM, Aliases{})
	}
}

func BenchmarkPropertiesEncode(b *testing.B) {
	in := []byte("hello=\u4f60\u597d\u4e16\u754c")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		PropertiesEncode(in)
	}
}

func BenchmarkCanonicalEncodingName(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		canonicalEncodingName("gb2312")
	}
}