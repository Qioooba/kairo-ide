package debug

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"testing"
)

// ── JDWPError Tests ──────────────────────────────────────────────

func TestJDWPError_Error(t *testing.T) {
	tests := []struct {
		name    string
		errCode int16
		msg     string
		want    string
	}{
		{"VM_DEAD", 10, "VM_DEAD", "JDWP error 10: VM_DEAD"},
		{"NOT_IMPLEMENTED", 99, "NOT_IMPLEMENTED", "JDWP error 99: NOT_IMPLEMENTED"},
		{"custom", 200, "custom error", "JDWP error 200: custom error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := &JDWPError{ErrCode: tt.errCode, Msg: tt.msg}
			got := e.Error()
			if got != tt.want {
				t.Errorf("Error() = %q, want %q", got, tt.want)
			}
		})
	}
}

// ── WriteJDWPPacket Tests ────────────────────────────────────────

func TestWriteJDWPPacket_NoData(t *testing.T) {
	var buf bytes.Buffer
	pkt := &JDWPPacket{
		ID:     1,
		Flags:  0,
		CmdSet: 1,
		Cmd:    1,
	}
	err := WriteJDWPPacket(&buf, pkt)
	if err != nil {
		t.Fatalf("WriteJDWPPacket failed: %v", err)
	}
	if buf.Len() != jdwpPacketHeaderSize {
		t.Errorf("packet length = %d, want %d", buf.Len(), jdwpPacketHeaderSize)
	}
}

func TestWriteJDWPPacket_WithData(t *testing.T) {
	var buf bytes.Buffer
	pkt := &JDWPPacket{
		ID:     42,
		Flags:  0,
		CmdSet: 15,
		Cmd:    1,
		Data:   []byte{1, 2, 3, 4},
	}
	err := WriteJDWPPacket(&buf, pkt)
	if err != nil {
		t.Fatalf("WriteJDWPPacket failed: %v", err)
	}
	expectedLen := jdwpPacketHeaderSize + 4
	if buf.Len() != expectedLen {
		t.Errorf("packet length = %d, want %d", buf.Len(), expectedLen)
	}

	// Verify the length field
	raw := buf.Bytes()
	length := int32(binary.BigEndian.Uint32(raw[0:4]))
	if length != int32(expectedLen) {
		t.Errorf("length field = %d, want %d", length, expectedLen)
	}

	// Verify ID
	id := int32(binary.BigEndian.Uint32(raw[4:8]))
	if id != 42 {
		t.Errorf("ID = %d, want 42", id)
	}
}

func TestWriteJDWPPacket_WriteError(t *testing.T) {
	pkt := &JDWPPacket{
		ID:     1,
		Flags:  0,
		CmdSet: 1,
		Cmd:    1,
	}
	err := WriteJDWPPacket(&errWriter{max: 0}, pkt)
	if err == nil {
		t.Error("Expected error from writer")
	}
}

func TestWriteJDWPPacket_DataWriteError(t *testing.T) {
	pkt := &JDWPPacket{
		ID:     1,
		Flags:  0,
		CmdSet: 1,
		Cmd:    1,
		Data:   []byte{1, 2, 3},
	}
	err := WriteJDWPPacket(&errWriter{max: jdwpPacketHeaderSize}, pkt)
	if err == nil {
		t.Error("Expected error when writing data")
	}
}

// errWriter returns an error after writing max bytes.
type errWriter struct {
	max int
	n   int
}

func (w *errWriter) Write(p []byte) (int, error) {
	w.n += len(p)
	if w.n > w.max {
		return 0, errors.New("write error")
	}
	return len(p), nil
}

// ── ReadJDWPPacket Tests ─────────────────────────────────────────

func TestReadJDWPPacket_CommandWithData(t *testing.T) {
	// Build a command packet with data
	data := []byte{0xAA, 0xBB, 0xCC}
	header := make([]byte, jdwpPacketHeaderSize)
	binary.BigEndian.PutUint32(header[0:4], uint32(jdwpPacketHeaderSize+len(data)))
	binary.BigEndian.PutUint32(header[4:8], 100)
	header[8] = 0    // flags (command)
	header[9] = 1    // cmdSet
	header[10] = 2   // cmd
	buf := append(header, data...)

	pkt, err := ReadJDWPPacket(bytes.NewReader(buf))
	if err != nil {
		t.Fatalf("ReadJDWPPacket failed: %v", err)
	}
	if pkt.ID != 100 {
		t.Errorf("ID = %d, want 100", pkt.ID)
	}
	if pkt.CmdSet != 1 {
		t.Errorf("CmdSet = %d, want 1", pkt.CmdSet)
	}
	if pkt.Cmd != 2 {
		t.Errorf("Cmd = %d, want 2", pkt.Cmd)
	}
	if len(pkt.Data) != 3 {
		t.Errorf("len(Data) = %d, want 3", len(pkt.Data))
	}
}

func TestReadJDWPPacket_ReplyNoData(t *testing.T) {
	header := make([]byte, jdwpPacketHeaderSize)
	binary.BigEndian.PutUint32(header[0:4], uint32(jdwpPacketHeaderSize))
	binary.BigEndian.PutUint32(header[4:8], 200)
	header[8] = 0x80 // reply flag
	header[9] = 0    // error code high
	header[10] = 0   // error code low

	pkt, err := ReadJDWPPacket(bytes.NewReader(header))
	if err != nil {
		t.Fatalf("ReadJDWPPacket failed: %v", err)
	}
	if pkt.ID != 200 {
		t.Errorf("ID = %d, want 200", pkt.ID)
	}
	if pkt.Flags != 0x80 {
		t.Errorf("Flags = %x, want 0x80", pkt.Flags)
	}
}

func TestReadJDWPPacket_ReplyWithError(t *testing.T) {
	// Build a reply with error code 99 (NOT_IMPLEMENTED)
	header := make([]byte, jdwpPacketHeaderSize)
	binary.BigEndian.PutUint32(header[0:4], uint32(jdwpPacketHeaderSize))
	binary.BigEndian.PutUint32(header[4:8], 300)
	header[8] = 0x80  // reply
	header[9] = 0     // error code high
	header[10] = 99   // error code low (NOT_IMPLEMENTED)

	pkt, err := ReadJDWPPacket(bytes.NewReader(header))
	if err == nil {
		t.Fatal("Expected error for reply with error code")
	}
	if pkt == nil {
		t.Fatal("Packet should not be nil")
	}
	if pkt.ErrCode != 99 {
		t.Errorf("ErrCode = %d, want 99", pkt.ErrCode)
	}
}

func TestReadJDWPPacket_ReplyWithErrorAndData(t *testing.T) {
	data := []byte{1, 2, 3, 4}
	header := make([]byte, jdwpPacketHeaderSize)
	binary.BigEndian.PutUint32(header[0:4], uint32(jdwpPacketHeaderSize+len(data)))
	binary.BigEndian.PutUint32(header[4:8], 400)
	header[8] = 0x80 // reply
	header[9] = 0    // error code high
	header[10] = 10  // error code low (VM_DEAD)
	buf := append(header, data...)

	pkt, err := ReadJDWPPacket(bytes.NewReader(buf))
	if err == nil {
		t.Fatal("Expected error for reply with error code")
	}
	if pkt.ErrCode != 10 {
		t.Errorf("ErrCode = %d, want 10", pkt.ErrCode)
	}
	if len(pkt.Data) != 4 {
		t.Errorf("len(Data) = %d, want 4", len(pkt.Data))
	}
}

func TestReadJDWPPacket_TruncatedHeader(t *testing.T) {
	_, err := ReadJDWPPacket(bytes.NewReader([]byte{0x00, 0x00}))
	if err == nil {
		t.Error("Expected error for truncated header")
	}
}

func TestReadJDWPPacket_TruncatedReplyData(t *testing.T) {
	// Declare 4 bytes of data but provide only 2
	header := make([]byte, jdwpPacketHeaderSize)
	binary.BigEndian.PutUint32(header[0:4], uint32(jdwpPacketHeaderSize+4))
	binary.BigEndian.PutUint32(header[4:8], 500)
	header[8] = 0x80
	header[9] = 0
	header[10] = 0
	buf := append(header, 1, 2) // only 2 bytes

	_, err := ReadJDWPPacket(bytes.NewReader(buf))
	if err == nil {
		t.Error("Expected error for truncated reply data")
	}
}

func TestReadJDWPPacket_TruncatedCommandData(t *testing.T) {
	header := make([]byte, jdwpPacketHeaderSize)
	binary.BigEndian.PutUint32(header[0:4], uint32(jdwpPacketHeaderSize+4))
	binary.BigEndian.PutUint32(header[4:8], 600)
	header[8] = 0
	header[9] = 1
	header[10] = 1
	buf := append(header, 1, 2) // only 2 bytes

	_, err := ReadJDWPPacket(bytes.NewReader(buf))
	if err == nil {
		t.Error("Expected error for truncated command data")
	}
}

func TestReadJDWPPacket_CommandNoData(t *testing.T) {
	header := make([]byte, jdwpPacketHeaderSize)
	binary.BigEndian.PutUint32(header[0:4], uint32(jdwpPacketHeaderSize))
	binary.BigEndian.PutUint32(header[4:8], 700)
	header[8] = 0
	header[9] = 1
	header[10] = 1

	pkt, err := ReadJDWPPacket(bytes.NewReader(header))
	if err != nil {
		t.Fatalf("ReadJDWPPacket failed: %v", err)
	}
	if pkt.ID != 700 {
		t.Errorf("ID = %d, want 700", pkt.ID)
	}
	if len(pkt.Data) != 0 {
		t.Errorf("len(Data) = %d, want 0", len(pkt.Data))
	}
}

// ── JDWPDataReader Edge Case Tests ───────────────────────────────

func TestReadLong_Truncated(t *testing.T) {
	r := NewJDWPDataReader([]byte{0x00, 0x00, 0x00})
	_, err := r.ReadLong()
	if err == nil {
		t.Error("Expected error for truncated long")
	}
}

func TestReadDouble_Truncated(t *testing.T) {
	r := NewJDWPDataReader([]byte{0x00, 0x00, 0x00})
	_, err := r.ReadDouble()
	if err == nil {
		t.Error("Expected error for truncated double")
	}
}

func TestReadFloat_Truncated(t *testing.T) {
	r := NewJDWPDataReader([]byte{0x00, 0x00})
	_, err := r.ReadFloat()
	if err == nil {
		t.Error("Expected error for truncated float")
	}
}

func TestReadString_NegativeLength(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(-1)
	data := w.Bytes()
	r := NewJDWPDataReader(data)
	_, err := r.ReadString()
	if err == nil {
		t.Error("Expected error for negative string length")
	}
}

func TestReadString_Truncated(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(10)
	data := w.Bytes() // no actual string data follows
	r := NewJDWPDataReader(data)
	_, err := r.ReadString()
	if err == nil {
		t.Error("Expected error for truncated string")
	}
}

func TestReadUntaggedValue_AllTags(t *testing.T) {
	tests := []struct {
		name string
		tag  byte
		data []byte
		want interface{}
	}{
		{"byte", jdwpTagByte, []byte{0x7F}, int8(127)},
		{"char", jdwpTagChar, []byte{0, 0, 0, 0x41}, uint16('A')},
		{"double", jdwpTagDouble, []byte{0x3F, 0xF0, 0, 0, 0, 0, 0, 0}, float64(1.0)},
		{"float", jdwpTagFloat, []byte{0x3F, 0x80, 0, 0}, float32(1.0)},
		{"int", jdwpTagInt, []byte{0, 0, 0, 42}, int32(42)},
		{"long", jdwpTagLong, []byte{0, 0, 0, 0, 0, 0, 0, 100}, int64(100)},
		{"short", jdwpTagShort, []byte{0, 0, 0, 10}, int16(10)},
		{"boolean", jdwpTagBoolean, []byte{1}, true},
		{"string_ref", jdwpTagString, []byte{0, 0, 0, 0, 0, 0, 0, 42}, int64(42)},
		{"array_ref", jdwpTagArray, []byte{0, 0, 0, 0, 0, 0, 0, 100}, int64(100)},
		{"object_ref", jdwpTagObject, []byte{0, 0, 0, 0, 0, 0, 0, 200}, int64(200)},
		{"thread_ref", jdwpTagThread, []byte{0, 0, 0, 0, 0, 0, 1, 44}, int64(300)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewJDWPDataReader(tt.data)
			got, err := r.ReadUntaggedValue(tt.tag)
			if err != nil {
				t.Fatalf("ReadUntaggedValue failed: %v", err)
			}
			if got != tt.want {
				t.Errorf("ReadUntaggedValue(%q) = %v, want %v", tt.name, got, tt.want)
			}
		})
	}
}

func TestReadUntaggedValue_UnknownTag(t *testing.T) {
	r := NewJDWPDataReader([]byte{})
	_, err := r.ReadUntaggedValue(0xFF)
	if err == nil {
		t.Error("Expected error for unknown tag")
	}
}

func TestReadTaggedValue(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(jdwpTagInt)
	w.WriteInt(42)
	data := w.Bytes()
	r := NewJDWPDataReader(data)
	tag, val, err := r.ReadTaggedValue()
	if err != nil {
		t.Fatalf("ReadTaggedValue failed: %v", err)
	}
	if tag != jdwpTagInt {
		t.Errorf("tag = %c, want I", tag)
	}
	if val.(int32) != 42 {
		t.Errorf("val = %d, want 42", val)
	}
}

func TestReadTaggedValue_TruncatedTag(t *testing.T) {
	r := NewJDWPDataReader([]byte{})
	_, _, err := r.ReadTaggedValue()
	if err == nil {
		t.Error("Expected error for empty data")
	}
}

func TestReadTaggedValue_TruncatedValue(t *testing.T) {
	r := NewJDWPDataReader([]byte{jdwpTagInt})
	_, _, err := r.ReadTaggedValue()
	if err == nil {
		t.Error("Expected error for truncated value after tag")
	}
}

func TestSkipBytes(t *testing.T) {
	data := []byte{1, 2, 3, 4, 5}
	r := NewJDWPDataReader(data)
	err := r.SkipBytes(3)
	if err != nil {
		t.Fatalf("SkipBytes failed: %v", err)
	}
	if r.pos != 3 {
		t.Errorf("pos = %d, want 3", r.pos)
	}
	b, err := r.ReadByte()
	if err != nil {
		t.Fatalf("ReadByte after skip failed: %v", err)
	}
	if b != 4 {
		t.Errorf("byte = %d, want 4", b)
	}
}

func TestSkipBytes_BeyondData(t *testing.T) {
	r := NewJDWPDataReader([]byte{1, 2})
	err := r.SkipBytes(5)
	if err == nil {
		t.Error("Expected error for skipping beyond data")
	}
}

func TestRemaining(t *testing.T) {
	tests := []struct {
		data []byte
		pos  int
		want int
	}{
		{[]byte{1, 2, 3}, 0, 3},
		{[]byte{1, 2, 3}, 1, 2},
		{[]byte{1, 2, 3}, 3, 0},
		{[]byte{1, 2, 3}, 5, 0},
		{nil, 0, 0},
	}
	for _, tt := range tests {
		r := &JDWPDataReader{data: tt.data, pos: tt.pos}
		got := r.Remaining()
		if got != tt.want {
			t.Errorf("Remaining() = %d, want %d", got, tt.want)
		}
	}
}

// ── WriteTaggedValue Tests ───────────────────────────────────────

func TestWriteTaggedValue_AllTypes(t *testing.T) {
	tests := []struct {
		name   string
		tag    byte
		value  interface{}
		length int // expected total bytes after tag
	}{
		{"byte", jdwpTagByte, int8(127), 1},
		{"char", jdwpTagChar, uint16('A'), 4},
		{"double", jdwpTagDouble, float64(3.14), 8},
		{"float", jdwpTagFloat, float32(1.5), 4},
		{"int", jdwpTagInt, int32(-42), 4},
		{"long", jdwpTagLong, int64(9999999999), 8},
		{"short", jdwpTagShort, int16(-100), 4},
		{"boolean_true", jdwpTagBoolean, true, 1},
		{"boolean_false", jdwpTagBoolean, false, 1},
		{"string_ref", jdwpTagString, int64(0x1234), 8},
		{"array_ref", jdwpTagArray, int64(0x5678), 8},
		{"object_ref", jdwpTagObject, int64(0xABCD), 8},
		{"thread_ref", jdwpTagThread, int64(0xEEFF), 8},
		{"thread_group_ref", jdwpTagThreadGroup, int64(0x1111), 8},
		{"class_loader_ref", jdwpTagClassLoader, int64(0x2222), 8},
		{"class_object_ref", jdwpTagClassObject, int64(0x3333), 8},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := NewJDWPDataWriter()
			w.WriteTaggedValue(tt.tag, tt.value)
			data := w.Bytes()
			if len(data) != 1+tt.length {
				t.Errorf("len(data) = %d, want %d", len(data), 1+tt.length)
			}
			if data[0] != tt.tag {
				t.Errorf("tag byte = %c, want %c", data[0], tt.tag)
			}
		})
	}
}

// ── jdwpErrorMessage Tests ───────────────────────────────────────

func TestJdwpErrorMessage_AllCodes(t *testing.T) {
	tests := []struct {
		code int16
		want string
	}{
		{10, "VM_DEAD"},
		{11, "THREAD_NOT_SUSPENDED"},
		{20, "INVALID_CLASS"},
		{21, "INVALID_CLASS_FORMAT"},
		{22, "INVALID_CLASS_LOADER"},
		{23, "INVALID_FIELDID"},
		{24, "INVALID_FRAMEID"},
		{25, "INVALID_INTERFACE"},
		{30, "INVALID_LENGTH"},
		{31, "INVALID_LOCATION"},
		{32, "INVALID_METHODID"},
		{33, "INVALID_OBJECT"},
		{34, "INVALID_STRING"},
		{35, "INVALID_THREAD"},
		{36, "INVALID_THREAD_GROUP"},
		{40, "INVALID_SLOT"},
		{41, "INVALID_TAG"},
		{42, "INVALID_ARRAY"},
		{50, "TYPE_MISMATCH"},
		{60, "INVALID_EVENT_TYPE"},
		{99, "NOT_IMPLEMENTED"},
		{100, "ABSENT_INFORMATION"},
		{101, "INVALID_TYPESTATE"},
		{110, "NATIVE_METHOD"},
		{111, "OPAQUE_FRAME"},
		{112, "NO_MORE_FRAMES"},
		{0, "UNKNOWN_ERROR_0"},
		{999, "UNKNOWN_ERROR_999"},
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got := jdwpErrorMessage(tt.code)
			if got != tt.want {
				t.Errorf("jdwpErrorMessage(%d) = %q, want %q", tt.code, got, tt.want)
			}
		})
	}
}

// ── ReadLong / ReadDouble / ReadFloat normal tests ───────────────

func TestReadLong_Normal(t *testing.T) {
	data := make([]byte, 8)
	binary.BigEndian.PutUint64(data, 0x7FFFFFFFFFFFFFFF)
	r := NewJDWPDataReader(data)
	v, err := r.ReadLong()
	if err != nil {
		t.Fatalf("ReadLong failed: %v", err)
	}
	if v != int64(0x7FFFFFFFFFFFFFFF) {
		t.Errorf("ReadLong = %x, want %x", v, 0x7FFFFFFFFFFFFFFF)
	}
}

func TestReadDouble_Normal(t *testing.T) {
	data := make([]byte, 8)
	binary.BigEndian.PutUint64(data, 0x3FF0000000000000) // 1.0
	r := NewJDWPDataReader(data)
	v, err := r.ReadDouble()
	if err != nil {
		t.Fatalf("ReadDouble failed: %v", err)
	}
	if v != 1.0 {
		t.Errorf("ReadDouble = %f, want 1.0", v)
	}
}

func TestReadFloat_Normal(t *testing.T) {
	data := make([]byte, 4)
	binary.BigEndian.PutUint32(data, 0x3F800000) // 1.0
	r := NewJDWPDataReader(data)
	v, err := r.ReadFloat()
	if err != nil {
		t.Fatalf("ReadFloat failed: %v", err)
	}
	if v != 1.0 {
		t.Errorf("ReadFloat = %f, want 1.0", v)
	}
}

// ── ReadBool Tests ───────────────────────────────────────────────

func TestReadBool(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want bool
	}{
		{"true", []byte{1}, true},
		{"false", []byte{0}, false},
		{"non_zero", []byte{5}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewJDWPDataReader(tt.data)
			got, err := r.ReadBool()
			if err != nil {
				t.Fatalf("ReadBool failed: %v", err)
			}
			if got != tt.want {
				t.Errorf("ReadBool() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestReadBool_Truncated(t *testing.T) {
	r := NewJDWPDataReader([]byte{})
	_, err := r.ReadBool()
	if err == nil {
		t.Error("Expected error for truncated bool")
	}
}

// ── ReadInt edge case ────────────────────────────────────────────

func TestReadInt_Truncated(t *testing.T) {
	r := NewJDWPDataReader([]byte{0x00, 0x00})
	_, err := r.ReadInt()
	if err == nil {
		t.Error("Expected error for truncated int")
	}
}

// ── ReadString empty ─────────────────────────────────────────────

func TestReadString_Empty(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(0)
	data := w.Bytes()
	r := NewJDWPDataReader(data)
	s, err := r.ReadString()
	if err != nil {
		t.Fatalf("ReadString failed: %v", err)
	}
	if s != "" {
		t.Errorf("ReadString() = %q, want empty", s)
	}
}

// ── ReadObjectID / ReadFrameID ───────────────────────────────────

func TestReadObjectID(t *testing.T) {
	data := make([]byte, 8)
	binary.BigEndian.PutUint64(data, 0x1234567890ABCDEF)
	r := NewJDWPDataReader(data)
	v, err := r.ReadObjectID()
	if err != nil {
		t.Fatalf("ReadObjectID failed: %v", err)
	}
	if v != int64(0x1234567890ABCDEF) {
		t.Errorf("ReadObjectID = %x, want %x", v, 0x1234567890ABCDEF)
	}
}

func TestReadFrameID(t *testing.T) {
	data := make([]byte, 8)
	binary.BigEndian.PutUint64(data, 0x1111111111111111)
	r := NewJDWPDataReader(data)
	v, err := r.ReadFrameID()
	if err != nil {
		t.Fatalf("ReadFrameID failed: %v", err)
	}
	if v != int64(0x1111111111111111) {
		t.Errorf("ReadFrameID = %x, want %x", v, 0x1111111111111111)
	}
}

// ── ReadByte edge case ───────────────────────────────────────────

func TestReadByte_Truncated(t *testing.T) {
	r := NewJDWPDataReader([]byte{})
	_, err := r.ReadByte()
	if err == nil {
		t.Error("Expected error for empty data")
	}
}

// ── WriteByte / WriteInt / WriteLong sanity ──────────────────────

func TestWriteByte(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteByte(0xAB)
	if w.Bytes()[0] != 0xAB {
		t.Errorf("WriteByte = %x, want AB", w.Bytes()[0])
	}
}

func TestWriteInt(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(-1)
	data := w.Bytes()
	if len(data) != 4 {
		t.Errorf("len(data) = %d, want 4", len(data))
	}
	v := int32(binary.BigEndian.Uint32(data))
	if v != -1 {
		t.Errorf("WriteInt = %d, want -1", v)
	}
}

func TestWriteLong(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteLong(-1)
	data := w.Bytes()
	if len(data) != 8 {
		t.Errorf("len(data) = %d, want 8", len(data))
	}
}

func TestWriteObjectID(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteObjectID(0xCAFE)
	data := w.Bytes()
	v := int64(binary.BigEndian.Uint64(data))
	if v != 0xCAFE {
		t.Errorf("WriteObjectID = %x, want CAFE", v)
	}
}

func TestWriteString(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteString("hi")
	data := w.Bytes()
	// 4 bytes length + 2 bytes content
	if len(data) != 6 {
		t.Errorf("len(data) = %d, want 6", len(data))
	}
}

func TestWriteDouble(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteDouble(mathFloat64(1.0))
	data := w.Bytes()
	if len(data) != 8 {
		t.Errorf("len(data) = %d, want 8", len(data))
	}
}

func TestWriteFloat(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteFloat(mathFloat32(1.0))
	data := w.Bytes()
	if len(data) != 4 {
		t.Errorf("len(data) = %d, want 4", len(data))
	}
}

// mathFloat64 avoids import of math
func mathFloat64(v float64) float64 { return v }
func mathFloat32(v float32) float32 { return v }

// ── Read from io.Reader error path ───────────────────────────────

func TestReadJDWPPacket_ReaderError(t *testing.T) {
	_, err := ReadJDWPPacket(&errorReader{})
	if err == nil {
		t.Error("Expected error from failing reader")
	}
}

type errorReader struct{}

func (e *errorReader) Read(p []byte) (int, error) {
	return 0, io.ErrUnexpectedEOF
}