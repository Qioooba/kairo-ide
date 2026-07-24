package debug

import (
	"encoding/binary"
	"math"
	"testing"
)

// ── Helper: build JDWP variable reply data ──────────────────────

// buildTaggedVariableReply builds a JDWP StackFrame.GetValues reply
// with the given slot/tag/value pairs.
func buildTaggedVariableReply(entries []struct {
	slot int32
	tag  byte
	raw  interface{}
}) []byte {
	w := NewJDWPDataWriter()
	w.WriteInt(int32(len(entries)))
	for _, e := range entries {
		w.WriteInt(e.slot)
		w.WriteByte(e.tag)
		switch e.tag {
		case jdwpTagByte:
			w.WriteByte(byte(e.raw.(int8)))
		case jdwpTagBoolean:
			if e.raw.(bool) {
				w.WriteByte(1)
			} else {
				w.WriteByte(0)
			}
		case jdwpTagInt:
			w.WriteInt(e.raw.(int32))
		case jdwpTagLong:
			w.WriteLong(e.raw.(int64))
		case jdwpTagShort:
			w.WriteInt(e.raw.(int32))
		case jdwpTagFloat:
			w.WriteFloat(e.raw.(float32))
		case jdwpTagDouble:
			w.WriteDouble(e.raw.(float64))
		case jdwpTagChar:
			w.WriteInt(e.raw.(int32))
		case jdwpTagObject:
			w.WriteObjectID(e.raw.(int64))
		case jdwpTagString:
			w.WriteObjectID(e.raw.(int64))
		case jdwpTagArray:
			w.WriteObjectID(e.raw.(int64))
		}
	}
	return w.Bytes()
}

// ── Variable Parsing Tests ──────────────────────────────────────

func TestParseVariableList_Primitives(t *testing.T) {
	data := buildTaggedVariableReply([]struct {
		slot int32
		tag  byte
		raw  interface{}
	}{
		{0, jdwpTagInt, int32(42)},
		{1, jdwpTagBoolean, true},
		{2, jdwpTagByte, int8(7)},
		{3, jdwpTagShort, int32(100)},
		{4, jdwpTagLong, int64(9999999999)},
		{5, jdwpTagFloat, float32(3.14)},
		{6, jdwpTagDouble, float64(2.718281828)},
		{7, jdwpTagChar, int32('A')},
	})

	names := []string{"count", "flag", "b", "s", "big", "pi", "e", "ch"}
	sigs := []string{"I", "Z", "B", "S", "J", "F", "D", "C"}

	result, err := ParseVariableList(data, names, sigs)
	if err != nil {
		t.Fatalf("ParseVariableList failed: %v", err)
	}

	if result.Count != 8 {
		t.Errorf("Count = %d, want 8", result.Count)
	}
	if len(result.Variables) != 8 {
		t.Fatalf("len(Variables) = %d, want 8", len(result.Variables))
	}

	checks := []struct {
		idx   int
		name  string
		kind  VariableKind
		value string
		tName string
	}{
		{0, "count", VarKindPrimitive, "42 (0x0000002a)", "int"},
		{1, "flag", VarKindPrimitive, "true", "boolean"},
		{2, "b", VarKindPrimitive, "7", "byte"},
		{3, "s", VarKindPrimitive, "100", "short"},
		{4, "big", VarKindPrimitive, "9999999999 (0x00000002540be3ff)", "long"},
		{5, "pi", VarKindPrimitive, "3.14", "float"},
		{6, "e", VarKindPrimitive, "2.718281828", "double"},
		{7, "ch", VarKindPrimitive, "'A' (0x0041)", "char"},
	}

	for _, c := range checks {
		v := result.Variables[c.idx]
		if v.Name != c.name {
			t.Errorf("Variables[%d].Name = %q, want %q", c.idx, v.Name, c.name)
		}
		if v.Kind != c.kind {
			t.Errorf("Variables[%d].Kind = %q, want %q", c.idx, v.Kind, c.kind)
		}
		if v.Value != c.value {
			t.Errorf("Variables[%d].Value = %q, want %q", c.idx, v.Value, c.value)
		}
		if v.TypeName != c.tName {
			t.Errorf("Variables[%d].TypeName = %q, want %q", c.idx, v.TypeName, c.tName)
		}
	}
}

func TestParseVariableList_ObjectReferences(t *testing.T) {
	data := buildTaggedVariableReply([]struct {
		slot int32
		tag  byte
		raw  interface{}
	}{
		{0, jdwpTagObject, int64(0xABCD)},
		{1, jdwpTagString, int64(0x1234)},
		{2, jdwpTagArray, int64(0x5678)},
		{3, jdwpTagObject, int64(0)}, // null
	})

	names := []string{"obj", "str", "arr", "nil"}
	sigs := []string{"Ljava/lang/Object;", "Ljava/lang/String;", "[I", "Ljava/lang/Object;"}

	result, err := ParseVariableList(data, names, sigs)
	if err != nil {
		t.Fatalf("ParseVariableList failed: %v", err)
	}

	if len(result.Variables) != 4 {
		t.Fatalf("len(Variables) = %d, want 4", len(result.Variables))
	}

	// obj
	if !result.Variables[0].HasChildren {
		t.Error("Object variable should have children")
	}
	if result.Variables[0].ObjectID != 0xABCD {
		t.Errorf("ObjectID = %d, want %d", result.Variables[0].ObjectID, 0xABCD)
	}

	// str
	if result.Variables[1].Kind != VarKindString {
		t.Errorf("String variable Kind = %q, want %q", result.Variables[1].Kind, VarKindString)
	}

	// arr
	if result.Variables[2].Kind != VarKindArray {
		t.Errorf("Array variable Kind = %q, want %q", result.Variables[2].Kind, VarKindArray)
	}

	// nil
	if result.Variables[3].Kind != VarKindNull {
		t.Errorf("Null variable Kind = %q, want %q", result.Variables[3].Kind, VarKindNull)
	}
	if result.Variables[3].Value != "null" {
		t.Errorf("Null variable Value = %q, want %q", result.Variables[3].Value, "null")
	}
}

func TestParseVariableList_Empty(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(0) // zero count
	data := w.Bytes()

	result, err := ParseVariableList(data, nil, nil)
	if err != nil {
		t.Fatalf("ParseVariableList empty failed: %v", err)
	}
	if result.Count != 0 {
		t.Errorf("Count = %d, want 0", result.Count)
	}
	if len(result.Variables) != 0 {
		t.Errorf("len(Variables) = %d, want 0", len(result.Variables))
	}
}

func TestParseVariableList_VoidIgnored(t *testing.T) {
	data := buildTaggedVariableReply([]struct {
		slot int32
		tag  byte
		raw  interface{}
	}{
		{0, jdwpTagInt, int32(1)},
		{1, jdwpTagVoid, int8(0)}, // void should be skipped
		{2, jdwpTagInt, int32(2)},
	})

	names := []string{"a", "void", "b"}
	result, err := ParseVariableList(data, names, nil)
	if err != nil {
		t.Fatalf("ParseVariableList failed: %v", err)
	}

	// Void entry should be skipped, so we get 2 variables
	if len(result.Variables) != 2 {
		t.Fatalf("len(Variables) = %d, want 2", len(result.Variables))
	}
	if result.Variables[0].Name != "a" {
		t.Errorf("Variables[0].Name = %q, want a", result.Variables[0].Name)
	}
	if result.Variables[1].Name != "b" {
		t.Errorf("Variables[1].Name = %q, want b", result.Variables[1].Name)
	}
}

func TestParseVariableList_NameOverflow(t *testing.T) {
	data := buildTaggedVariableReply([]struct {
		slot int32
		tag  byte
		raw  interface{}
	}{
		{0, jdwpTagInt, int32(1)},
		{1, jdwpTagInt, int32(2)},
	})

	// Only one name provided
	names := []string{"only"}
	result, err := ParseVariableList(data, names, nil)
	if err != nil {
		t.Fatalf("ParseVariableList failed: %v", err)
	}

	if len(result.Variables) != 2 {
		t.Fatalf("len(Variables) = %d, want 2", len(result.Variables))
	}
	if result.Variables[0].Name != "only" {
		t.Errorf("Variables[0].Name = %q, want only", result.Variables[0].Name)
	}
	// Second variable should get an auto-generated name
	if result.Variables[1].Name != "var1" {
		t.Errorf("Variables[1].Name = %q, want var1", result.Variables[1].Name)
	}
}

func TestParseVariableList_InvalidData(t *testing.T) {
	// Truncated data
	_, err := ParseVariableList([]byte{0x00, 0x00}, nil, nil)
	if err == nil {
		t.Error("Expected error for truncated data")
	}
}

// ── Field Parsing Tests ─────────────────────────────────────────

func TestParseFieldList(t *testing.T) {
	data := buildFieldListReply([]struct {
		tag byte
		raw interface{}
	}{
		{jdwpTagInt, int32(100)},
		{jdwpTagBoolean, true},
	})

	names := []string{"x", "valid"}
	sigs := []string{"I", "Z"}

	result, err := ParseFieldList(data, names, sigs)
	if err != nil {
		t.Fatalf("ParseFieldList failed: %v", err)
	}

	if len(result.Variables) != 2 {
		t.Fatalf("len(Variables) = %d, want 2", len(result.Variables))
	}
	if result.Variables[0].Value != "100 (0x00000064)" {
		t.Errorf("field x = %q", result.Variables[0].Value)
	}
	if result.Variables[1].Value != "true" {
		t.Errorf("field valid = %q", result.Variables[1].Value)
	}
}

// buildFieldListReply builds a JDWP ObjectReference.GetValues reply.
func buildFieldListReply(entries []struct {
	tag byte
	raw interface{}
}) []byte {
	w := NewJDWPDataWriter()
	w.WriteInt(int32(len(entries)))
	for _, e := range entries {
		w.WriteByte(e.tag)
		switch e.tag {
		case jdwpTagByte:
			w.WriteByte(byte(e.raw.(int8)))
		case jdwpTagBoolean:
			if e.raw.(bool) {
				w.WriteByte(1)
			} else {
				w.WriteByte(0)
			}
		case jdwpTagInt:
			w.WriteInt(e.raw.(int32))
		case jdwpTagLong:
			w.WriteLong(e.raw.(int64))
		case jdwpTagShort:
			w.WriteInt(e.raw.(int32))
		case jdwpTagFloat:
			w.WriteFloat(e.raw.(float32))
		case jdwpTagDouble:
			w.WriteDouble(e.raw.(float64))
		case jdwpTagChar:
			w.WriteInt(e.raw.(int32))
		case jdwpTagObject:
			w.WriteObjectID(e.raw.(int64))
		case jdwpTagString:
			w.WriteObjectID(e.raw.(int64))
		}
	}
	return w.Bytes()
}

// ── Array Parsing Tests ─────────────────────────────────────────

func TestParseArrayElements(t *testing.T) {
	// Build an array of 3 ints
	w := NewJDWPDataWriter()
	w.WriteByte(jdwpTagInt) // array type tag
	w.WriteInt(3)            // count
	w.WriteInt(10)
	w.WriteInt(20)
	w.WriteInt(30)
	data := w.Bytes()

	result, err := ParseArrayElements(data, jdwpTagInt, 0)
	if err != nil {
		t.Fatalf("ParseArrayElements failed: %v", err)
	}

	if result.Count != 3 {
		t.Errorf("Count = %d, want 3", result.Count)
	}
	if len(result.Variables) != 3 {
		t.Fatalf("len(Variables) = %d, want 3", len(result.Variables))
	}

	expected := []struct {
		name  string
		value string
	}{
		{"[0]", "10 (0x0000000a)"},
		{"[1]", "20 (0x00000014)"},
		{"[2]", "30 (0x0000001e)"},
	}

	for i, exp := range expected {
		if result.Variables[i].Name != exp.name {
			t.Errorf("[%d].Name = %q, want %q", i, result.Variables[i].Name, exp.name)
		}
		if result.Variables[i].Value != exp.value {
			t.Errorf("[%d].Value = %q, want %q", i, result.Variables[i].Value, exp.value)
		}
	}
}

func TestParseArrayElements_WithOffset(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(jdwpTagInt)
	w.WriteInt(2)
	w.WriteInt(100)
	w.WriteInt(200)
	data := w.Bytes()

	result, err := ParseArrayElements(data, jdwpTagInt, 5)
	if err != nil {
		t.Fatalf("ParseArrayElements failed: %v", err)
	}

	if result.Variables[0].Name != "[5]" {
		t.Errorf("[0].Name = %q, want [5]", result.Variables[0].Name)
	}
	if result.Variables[1].Name != "[6]" {
		t.Errorf("[1].Name = %q, want [6]", result.Variables[1].Name)
	}
}

// ── String Parsing Tests ────────────────────────────────────────

func TestParseStringValue(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteString("Hello, World!")
	data := w.Bytes()

	s, err := ParseStringValue(data)
	if err != nil {
		t.Fatalf("ParseStringValue failed: %v", err)
	}
	if s != "Hello, World!" {
		t.Errorf("Got %q, want %q", s, "Hello, World!")
	}
}

func TestParseStringValue_Empty(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteString("")
	data := w.Bytes()

	s, err := ParseStringValue(data)
	if err != nil {
		t.Fatalf("ParseStringValue failed: %v", err)
	}
	if s != "" {
		t.Errorf("Got %q, want empty", s)
	}
}

// ── Signature Parsing Tests ─────────────────────────────────────

func TestJdwpSignatureToTypeName(t *testing.T) {
	tests := []struct {
		sig  string
		want string
	}{
		{"", ""},
		{"I", "int"},
		{"J", "long"},
		{"Z", "boolean"},
		{"B", "byte"},
		{"C", "char"},
		{"S", "short"},
		{"D", "double"},
		{"F", "float"},
		{"V", "void"},
		{"Ljava/lang/String;", "java.lang.String"},
		{"Ljava/util/List;", "java.util.List"},
		{"[I", "int[]"},
		{"[[Ljava/lang/String;", "java.lang.String[][]"},
		{"[Ljava/lang/Object;", "java.lang.Object[]"},
	}

	for _, tt := range tests {
		got := jdwpSignatureToTypeName(tt.sig)
		if got != tt.want {
			t.Errorf("jdwpSignatureToTypeName(%q) = %q, want %q", tt.sig, got, tt.want)
		}
	}
}

// ── Tag Mapping Tests ───────────────────────────────────────────

func TestJdwpTagToKind(t *testing.T) {
	tests := []struct {
		tag  byte
		kind VariableKind
	}{
		{jdwpTagByte, VarKindPrimitive},
		{jdwpTagInt, VarKindPrimitive},
		{jdwpTagLong, VarKindPrimitive},
		{jdwpTagBoolean, VarKindPrimitive},
		{jdwpTagString, VarKindString},
		{jdwpTagArray, VarKindArray},
		{jdwpTagObject, VarKindObject},
		{jdwpTagThread, VarKindObject},
		{0xFF, VarKindUnknown},
	}

	for _, tt := range tests {
		got := jdwpTagToKind(tt.tag)
		if got != tt.kind {
			t.Errorf("jdwpTagToKind('%c') = %q, want %q", tt.tag, got, tt.kind)
		}
	}
}

// ── Value Formatting Tests ──────────────────────────────────────

func TestFormatValue(t *testing.T) {
	tests := []struct {
		tag  byte
		raw  interface{}
		want string
	}{
		{jdwpTagInt, int32(255), "255 (0x000000ff)"},
		{jdwpTagLong, int64(255), "255 (0x00000000000000ff)"},
		{jdwpTagBoolean, true, "true"},
		{jdwpTagBoolean, false, "false"},
		{jdwpTagChar, uint16('A'), "'A'"},
		{jdwpTagFloat, float32(1.5), "1.5"},
		{jdwpTagDouble, float64(3.14159), "3.14159"},
		{jdwpTagByte, int8(-1), "-1"},
		{jdwpTagShort, int16(-1), "-1"},
		{jdwpTagString, "hello", "\"hello\""},
	}

	for _, tt := range tests {
		got := FormatValue(tt.tag, tt.raw)
		if got != tt.want {
			t.Errorf("FormatValue('%c', %v) = %q, want %q", tt.tag, tt.raw, got, tt.want)
		}
	}
}

func TestTruncateString(t *testing.T) {
	short := "hello"
	if got := truncateString(short, 10); got != "\"hello\"" {
		t.Errorf("truncateString short = %q", got)
	}

	long := "abcdefghijklmnopqrstuvwxyz"
	result := truncateString(long, 5)
	if len(result) > 30 {
		t.Errorf("truncateString long should be truncated, got %q", result)
	}
}

func TestFormatArraySummary(t *testing.T) {
	got := FormatArraySummary("int[]", 42)
	want := "int[][42]"
	if got != want {
		t.Errorf("FormatArraySummary = %q, want %q", got, want)
	}
}

// ── JDWP Command Builder Tests ──────────────────────────────────

func TestBuildStackFrameGetValuesCommand(t *testing.T) {
	data := BuildStackFrameGetValuesCommand(100, 200, []int32{0, 1}, []byte{jdwpTagInt})
	r := NewJDWPDataReader(data)

	threadID, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if threadID != 100 {
		t.Errorf("threadID = %d, want 100", threadID)
	}

	frameID, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if frameID != 200 {
		t.Errorf("frameID = %d, want 200", frameID)
	}

	count, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("count = %d, want 2", count)
	}
}

func TestBuildArrayReferenceGetValuesCommand(t *testing.T) {
	data := BuildArrayReferenceGetValuesCommand(0xABCD, 0, 10)
	r := NewJDWPDataReader(data)

	oid, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if oid != 0xABCD {
		t.Errorf("objectID = %d, want %d", oid, 0xABCD)
	}

	first, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if first != 0 {
		t.Errorf("firstIndex = %d, want 0", first)
	}

	length, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if length != 10 {
		t.Errorf("length = %d, want 10", length)
	}
}

// ── JDWP Packet Round-Trip Tests ────────────────────────────────

func TestJDWPDataWriterReader_RoundTrip(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(0x42)
	w.WriteInt(12345)
	w.WriteLong(9876543210)
	w.WriteString("test")
	w.WriteObjectID(0xDEADBEEF)
	data := w.Bytes()

	r := NewJDWPDataReader(data)

	b, err := r.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if b != 0x42 {
		t.Errorf("byte = %d, want 0x42", b)
	}

	i, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if i != 12345 {
		t.Errorf("int = %d, want 12345", i)
	}

	l, err := r.ReadLong()
	if err != nil {
		t.Fatal(err)
	}
	if l != 9876543210 {
		t.Errorf("long = %d, want 9876543210", l)
	}

	s, err := r.ReadString()
	if err != nil {
		t.Fatal(err)
	}
	if s != "test" {
		t.Errorf("string = %q, want test", s)
	}

	oid, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if oid != 0xDEADBEEF {
		t.Errorf("objectID = %d, want 0xDEADBEEF", oid)
	}
}

func TestJDWPDataReader_Remaining(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(42)
	w.WriteInt(99)
	data := w.Bytes()

	r := NewJDWPDataReader(data)
	if r.Remaining() != 8 {
		t.Errorf("Remaining = %d, want 8", r.Remaining())
	}
	r.ReadInt()
	if r.Remaining() != 4 {
		t.Errorf("Remaining = %d, want 4", r.Remaining())
	}
}

func TestJDWPDataReader_ReadBool(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(1) // true
	w.WriteByte(0) // false
	data := w.Bytes()

	r := NewJDWPDataReader(data)

	v1, err := r.ReadBool()
	if err != nil {
		t.Fatal(err)
	}
	if !v1 {
		t.Error("first bool should be true")
	}

	v2, err := r.ReadBool()
	if err != nil {
		t.Fatal(err)
	}
	if v2 {
		t.Error("second bool should be false")
	}
}

func TestJDWPDataReader_ReadDouble(t *testing.T) {
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, math.Float64bits(3.141592653589793))
	r := NewJDWPDataReader(buf)

	v, err := r.ReadDouble()
	if err != nil {
		t.Fatal(err)
	}
	if v != 3.141592653589793 {
		t.Errorf("double = %v, want 3.141592653589793", v)
	}
}

func TestJDWPDataReader_ReadFloat(t *testing.T) {
	buf := make([]byte, 4)
	binary.BigEndian.PutUint32(buf, math.Float32bits(2.5))
	r := NewJDWPDataReader(buf)

	v, err := r.ReadFloat()
	if err != nil {
		t.Fatal(err)
	}
	if v != 2.5 {
		t.Errorf("float = %v, want 2.5", v)
	}
}

func TestJDWPDataReader_SkipBytes(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(1)
	w.WriteInt(2)
	w.WriteInt(3)
	data := w.Bytes()

	r := NewJDWPDataReader(data)
	r.ReadInt() // skip first
	r.SkipBytes(4) // skip second
	v, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if v != 3 {
		t.Errorf("int = %d, want 3", v)
	}
}

func TestJDWPDataReader_ReadTaggedValue(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(jdwpTagInt)
	w.WriteInt(42)
	data := w.Bytes()

	r := NewJDWPDataReader(data)
	tag, val, err := r.ReadTaggedValue()
	if err != nil {
		t.Fatal(err)
	}
	if tag != jdwpTagInt {
		t.Errorf("tag = %c, want I", tag)
	}
	if val.(int32) != 42 {
		t.Errorf("val = %d, want 42", val)
	}
}

// ── JDWP Error Message Tests ────────────────────────────────────

func TestJdwpErrorMessage(t *testing.T) {
	tests := []struct {
		code int16
		want string
	}{
		{10, "VM_DEAD"},
		{11, "THREAD_NOT_SUSPENDED"},
		{20, "INVALID_CLASS"},
		{33, "INVALID_OBJECT"},
		{35, "INVALID_THREAD"},
		{99, "NOT_IMPLEMENTED"},
		{100, "ABSENT_INFORMATION"},
		{110, "NATIVE_METHOD"},
		{112, "NO_MORE_FRAMES"},
		{999, "UNKNOWN_ERROR_999"},
	}

	for _, tt := range tests {
		got := jdwpErrorMessage(tt.code)
		if got != tt.want {
			t.Errorf("jdwpErrorMessage(%d) = %q, want %q", tt.code, got, tt.want)
		}
	}
}

// ── parseVariableFromUntagged Tests ──────────────────────────────

func TestParseVariableFromUntagged_AllTypes(t *testing.T) {
	tests := []struct {
		name string
		tag  byte
		data []byte
	}{
		{"byte", jdwpTagByte, []byte{0x7F}},
		{"char", jdwpTagChar, []byte{0, 0, 0, 0x41}},
		{"double", jdwpTagDouble, []byte{0x3F, 0xF0, 0, 0, 0, 0, 0, 0}},
		{"float", jdwpTagFloat, []byte{0x3F, 0x80, 0, 0}},
		{"int", jdwpTagInt, []byte{0, 0, 0, 42}},
		{"long", jdwpTagLong, []byte{0, 0, 0, 0, 0, 0, 0, 100}},
		{"short", jdwpTagShort, []byte{0, 0, 0, 10}},
		{"boolean_true", jdwpTagBoolean, []byte{1}},
		{"boolean_false", jdwpTagBoolean, []byte{0}},
		{"string", jdwpTagString, makeObjIDBytes(42)},
		{"array", jdwpTagArray, makeObjIDBytes(100)},
		{"object", jdwpTagObject, makeObjIDBytes(200)},
		{"thread", jdwpTagThread, makeObjIDBytes(300)},
		{"null_object", jdwpTagObject, makeObjIDBytes(0)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewJDWPDataReader(tt.data)
			v, err := parseVariableFromUntagged(r, tt.tag)
			if err != nil {
				t.Fatalf("parseVariableFromUntagged failed: %v", err)
			}
			if v == nil {
				t.Fatal("Expected non-nil variable")
			}
			if v.Tag != tt.tag {
				t.Errorf("Tag = %c, want %c", v.Tag, tt.tag)
			}
		})
	}
}

func TestParseVariableFromUntagged_Void(t *testing.T) {
	r := NewJDWPDataReader([]byte{})
	v, err := parseVariableFromUntagged(r, jdwpTagVoid)
	if err != nil {
		t.Fatalf("parseVariableFromUntagged void failed: %v", err)
	}
	if v != nil {
		t.Error("Void tag should return nil")
	}
}

func makeObjIDBytes(id int64) []byte {
	b := make([]byte, 8)
	b[7] = byte(id)
	b[6] = byte(id >> 8)
	b[5] = byte(id >> 16)
	b[4] = byte(id >> 24)
	b[3] = byte(id >> 32)
	b[2] = byte(id >> 40)
	b[1] = byte(id >> 48)
	b[0] = byte(id >> 56)
	return b
}

// ── jdwpTagToTypeName Tests ──────────────────────────────────────

func TestJdwpTagToTypeName(t *testing.T) {
	tests := []struct {
		tag  byte
		want string
	}{
		{jdwpTagByte, "byte"},
		{jdwpTagChar, "char"},
		{jdwpTagDouble, "double"},
		{jdwpTagFloat, "float"},
		{jdwpTagInt, "int"},
		{jdwpTagLong, "long"},
		{jdwpTagShort, "short"},
		{jdwpTagBoolean, "boolean"},
		{jdwpTagString, "java.lang.String"},
		{jdwpTagArray, "array"},
		{jdwpTagObject, "java.lang.Object"},
		{jdwpTagThread, "java.lang.Thread"},
		{jdwpTagThreadGroup, "java.lang.ThreadGroup"},
		{jdwpTagClassLoader, "java.lang.ClassLoader"},
		{jdwpTagClassObject, "java.lang.Class"},
		{0xFF, "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got := jdwpTagToTypeName(tt.tag)
			if got != tt.want {
				t.Errorf("jdwpTagToTypeName('%c') = %q, want %q", tt.tag, got, tt.want)
			}
		})
	}
}

// ── arrayTypeToElementTag Tests ──────────────────────────────────

func TestArrayTypeToElementTag(t *testing.T) {
	tests := []struct {
		name     string
		arrTag   byte
		wantTag  byte
	}{
		{"object_array", jdwpTagArray, jdwpTagObject},
		{"int_array", jdwpTagInt, jdwpTagInt},
		{"byte_array", jdwpTagByte, jdwpTagByte},
		{"char_array", jdwpTagChar, jdwpTagChar},
		{"boolean_array", jdwpTagBoolean, jdwpTagBoolean},
		{"double_array", jdwpTagDouble, jdwpTagDouble},
		{"float_array", jdwpTagFloat, jdwpTagFloat},
		{"long_array", jdwpTagLong, jdwpTagLong},
		{"short_array", jdwpTagShort, jdwpTagShort},
		{"string_array", jdwpTagString, jdwpTagString},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := arrayTypeToElementTag(tt.arrTag)
			if got != tt.wantTag {
				t.Errorf("arrayTypeToElementTag('%c') = '%c', want '%c'", tt.arrTag, got, tt.wantTag)
			}
		})
	}
}

// ── FormatValue edge cases ───────────────────────────────────────

func TestFormatValue_EdgeCases(t *testing.T) {
	tests := []struct {
		name string
		tag  byte
		raw  interface{}
		want string
	}{
		{"wrong_type_byte", jdwpTagByte, "not_int8", "not_int8"},
		{"wrong_type_short", jdwpTagShort, "not_int16", "not_int16"},
		{"wrong_type_int", jdwpTagInt, "not_int32", "not_int32"},
		{"wrong_type_long", jdwpTagLong, "not_int64", "not_int64"},
		{"wrong_type_float", jdwpTagFloat, "not_float32", "not_float32"},
		{"wrong_type_double", jdwpTagDouble, "not_float64", "not_float64"},
		{"wrong_type_bool", jdwpTagBoolean, "not_bool", "not_bool"},
		{"wrong_type_char", jdwpTagChar, "not_char", "not_char"},
		{"wrong_type_string", jdwpTagString, 123, "123"},
		{"unknown_tag", byte(0xFF), "hello", "hello"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FormatValue(tt.tag, tt.raw)
			if got != tt.want {
				t.Errorf("FormatValue('%c', %v) = %q, want %q", tt.tag, tt.raw, got, tt.want)
			}
		})
	}
}

// ── BuildObjectReferenceGetValuesCommand Tests ───────────────────

func TestBuildObjectReferenceGetValuesCommand(t *testing.T) {
	data := BuildObjectReferenceGetValuesCommand(0x100, []int64{0x200, 0x300})
	r := NewJDWPDataReader(data)

	oid, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if oid != 0x100 {
		t.Errorf("objectID = %d, want 0x100", oid)
	}

	count, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("field count = %d, want 2", count)
	}

	fid1, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if fid1 != 0x200 {
		t.Errorf("fieldID[0] = %d, want 0x200", fid1)
	}

	fid2, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if fid2 != 0x300 {
		t.Errorf("fieldID[1] = %d, want 0x300", fid2)
	}
}

func TestBuildObjectReferenceGetValuesCommand_Empty(t *testing.T) {
	data := BuildObjectReferenceGetValuesCommand(0x100, nil)
	r := NewJDWPDataReader(data)

	oid, _ := r.ReadObjectID()
	count, _ := r.ReadInt()
	if count != 0 {
		t.Errorf("field count = %d, want 0", count)
	}
	if oid != 0x100 {
		t.Errorf("objectID = %d, want 0x100", oid)
	}
}

// ── BuildStringReferenceValueCommand Tests ───────────────────────

func TestBuildStringReferenceValueCommand(t *testing.T) {
	data := BuildStringReferenceValueCommand(0xABCD)
	r := NewJDWPDataReader(data)

	oid, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if oid != 0xABCD {
		t.Errorf("objectID = %d, want 0xABCD", oid)
	}
}

// ── BuildArrayReferenceLengthCommand Tests ───────────────────────

func TestBuildArrayReferenceLengthCommand(t *testing.T) {
	data := BuildArrayReferenceLengthCommand(0x1234)
	r := NewJDWPDataReader(data)

	oid, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if oid != 0x1234 {
		t.Errorf("arrayID = %d, want 0x1234", oid)
	}
}

// ── ParseFieldList edge cases ────────────────────────────────────

func TestParseFieldList_InvalidData(t *testing.T) {
	_, err := ParseFieldList([]byte{0x00}, nil, nil)
	if err == nil {
		t.Error("Expected error for truncated field list")
	}
}

func TestParseFieldList_Empty(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(0)
	data := w.Bytes()

	result, err := ParseFieldList(data, nil, nil)
	if err != nil {
		t.Fatalf("ParseFieldList empty failed: %v", err)
	}
	if result.Count != 0 {
		t.Errorf("Count = %d, want 0", result.Count)
	}
	if len(result.Variables) != 0 {
		t.Errorf("len(Variables) = %d, want 0", len(result.Variables))
	}
}

// ── ParseArrayElements edge cases ────────────────────────────────

func TestParseArrayElements_InvalidData(t *testing.T) {
	_, err := ParseArrayElements([]byte{0x00}, jdwpTagInt, 0)
	if err == nil {
		t.Error("Expected error for truncated array elements")
	}
}

func TestParseArrayElements_Empty(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(jdwpTagInt)
	w.WriteInt(0)
	data := w.Bytes()

	result, err := ParseArrayElements(data, jdwpTagInt, 0)
	if err != nil {
		t.Fatalf("ParseArrayElements empty failed: %v", err)
	}
	if result.Count != 0 {
		t.Errorf("Count = %d, want 0", result.Count)
	}
	if len(result.Variables) != 0 {
		t.Errorf("len(Variables) = %d, want 0", len(result.Variables))
	}
}

// ── ParseStringValue edge case ───────────────────────────────────

func TestParseStringValue_InvalidData(t *testing.T) {
	_, err := ParseStringValue([]byte{0x00})
	if err == nil {
		t.Error("Expected error for truncated string value")
	}
}

// ── Variable / VariableList structs ──────────────────────────────

func TestVariable_HasChildren(t *testing.T) {
	v := &Variable{
		Name:        "test",
		Value:       "42",
		Kind:        VarKindObject,
		ObjectID:    100,
		HasChildren: true,
		Children:    []*Variable{{Name: "child"}},
	}
	if !v.HasChildren {
		t.Error("HasChildren should be true")
	}
	if len(v.Children) != 1 {
		t.Errorf("len(Children) = %d, want 1", len(v.Children))
	}
}

func TestVariableList_Count(t *testing.T) {
	vl := &VariableList{
		Variables: []*Variable{
			{Name: "a"},
			{Name: "b"},
		},
		Count: 2,
	}
	if vl.Count != 2 {
		t.Errorf("Count = %d, want 2", vl.Count)
	}
	if len(vl.Variables) != 2 {
		t.Errorf("len(Variables) = %d, want 2", len(vl.Variables))
	}
}