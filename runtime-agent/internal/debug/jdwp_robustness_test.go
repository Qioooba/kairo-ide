package debug

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"net"
	"sync"
	"testing"
)

// ── T20: char & short 2-byte alignment and no remaining drift (F08) ──────────

func TestJDWP_CharShortTwoByteAlignment_T20(t *testing.T) {
	// Test 1: Combined packet with char, short, and int.
	// In JDWP, char is 2 bytes (unsigned 16-bit) and short is 2 bytes (signed 16-bit).
	// Total payload must be exactly 2 + 2 + 4 = 8 bytes.
	buf := make([]byte, 8)
	// char = '中' (0x4E2D)
	binary.BigEndian.PutUint16(buf[0:2], uint16('中'))
	// short = -1 (0xFFFF)
	binary.BigEndian.PutUint16(buf[2:4], 0xFFFF)
	// int = 42 (0x0000002A)
	binary.BigEndian.PutUint32(buf[4:8], 42)

	r := NewJDWPDataReader(buf)

	// Read char
	rawChar, err := r.ReadUntaggedValue(jdwpTagChar)
	if err != nil {
		t.Fatalf("ReadUntaggedValue(char) error: %v", err)
	}
	gotChar, ok := rawChar.(uint16)
	if !ok || gotChar != uint16('中') {
		t.Fatalf("got char %v (%T), want %v ('中')", rawChar, rawChar, uint16('中'))
	}

	// Read short
	rawShort, err := r.ReadUntaggedValue(jdwpTagShort)
	if err != nil {
		t.Fatalf("ReadUntaggedValue(short) error: %v", err)
	}
	gotShort, ok := rawShort.(int16)
	if !ok || gotShort != -1 {
		t.Fatalf("got short %v (%T), want -1", rawShort, rawShort)
	}

	// Read int
	rawInt, err := r.ReadUntaggedValue(jdwpTagInt)
	if err != nil {
		t.Fatalf("ReadUntaggedValue(int) error: %v", err)
	}
	gotInt, ok := rawInt.(int32)
	if !ok || gotInt != 42 {
		t.Fatalf("got int %v (%T), want 42", rawInt, rawInt)
	}

	// Remaining must be strictly zero (no 2-byte cursor drift!)
	if rem := r.Remaining(); rem != 0 {
		t.Fatalf("remaining bytes = %d, want 0 (cursor drifted)", rem)
	}

	// Test 2: Min/Max boundary values for short and ASCII char.
	buf2 := make([]byte, 6)
	binary.BigEndian.PutUint16(buf2[0:2], uint16('A'))
	binary.BigEndian.PutUint16(buf2[2:4], 0x8000) // math.MinInt16 (-32768)
	binary.BigEndian.PutUint16(buf2[4:6], uint16(math.MaxInt16))

	r2 := NewJDWPDataReader(buf2)
	c2, err := r2.ReadChar()
	if err != nil || c2 != uint16('A') {
		t.Fatalf("ReadChar got %v, err %v", c2, err)
	}
	sMin, err := r2.ReadShort()
	if err != nil || sMin != math.MinInt16 {
		t.Fatalf("ReadShort MinInt16 got %v, err %v", sMin, err)
	}
	sMax, err := r2.ReadShort()
	if err != nil || sMax != math.MaxInt16 {
		t.Fatalf("ReadShort MaxInt16 got %v, err %v", sMax, err)
	}
	if rem := r2.Remaining(); rem != 0 {
		t.Fatalf("r2 remaining = %d, want 0", rem)
	}

	// Test 3: WriteTaggedValue wire format: tag (1 byte) + value (2 bytes) = 3 bytes total
	w := NewJDWPDataWriter()
	w.WriteTaggedValue(jdwpTagChar, uint16('A'))
	w.WriteTaggedValue(jdwpTagShort, int16(-100))
	wireBytes := w.Bytes()
	if len(wireBytes) != 6 {
		t.Fatalf("tagged char+short wire length = %d, want 6 (3+3)", len(wireBytes))
	}

	// Tagged read back
	r3 := NewJDWPDataReader(wireBytes)
	tag1, val1, err1 := r3.ReadTaggedValue()
	if err1 != nil || tag1 != jdwpTagChar || val1.(uint16) != uint16('A') {
		t.Fatalf("ReadTaggedValue(char) got tag=%c val=%v err=%v", tag1, val1, err1)
	}
	tag2, val2, err2 := r3.ReadTaggedValue()
	if err2 != nil || tag2 != jdwpTagShort || val2.(int16) != -100 {
		t.Fatalf("ReadTaggedValue(short) got tag=%c val=%v err=%v", tag2, val2, err2)
	}
	if rem := r3.Remaining(); rem != 0 {
		t.Fatalf("r3 remaining = %d, want 0", rem)
	}
}

// ── T21: JDWP Handshake TCP ReadFull with arbitrary fragmentation (F09) ──────

type fragmentedReader struct {
	data     []byte
	pos      int
	maxChunk int
}

func (f *fragmentedReader) Read(p []byte) (int, error) {
	if f.pos >= len(f.data) {
		return 0, io.EOF
	}
	n := len(p)
	if n > f.maxChunk {
		n = f.maxChunk
	}
	if n > len(f.data)-f.pos {
		n = len(f.data) - f.pos
	}
	copy(p, f.data[f.pos:f.pos+n])
	f.pos += n
	return n, nil
}

func TestJDWP_HandshakeFragmentedRead_T21(t *testing.T) {
	// Sub-test 1: 1-byte per chunk reading with io.ReadFull
	t.Run("one_byte_chunks", func(t *testing.T) {
		fr := &fragmentedReader{
			data:     []byte(jdwpHandshake),
			maxChunk: 1,
		}
		buf := make([]byte, len(jdwpHandshake))
		n, err := io.ReadFull(fr, buf)
		if err != nil {
			t.Fatalf("ReadFull 1-byte chunks failed: %v", err)
		}
		if n != len(jdwpHandshake) || string(buf) != jdwpHandshake {
			t.Fatalf("got %s (len %d), want %s", string(buf), n, jdwpHandshake)
		}
	})

	// Sub-test 2: Irregular chunks (3 bytes at a time)
	t.Run("irregular_chunks_3_bytes", func(t *testing.T) {
		fr := &fragmentedReader{
			data:     []byte(jdwpHandshake),
			maxChunk: 3,
		}
		buf := make([]byte, len(jdwpHandshake))
		n, err := io.ReadFull(fr, buf)
		if err != nil {
			t.Fatalf("ReadFull 3-byte chunks failed: %v", err)
		}
		if n != len(jdwpHandshake) || string(buf) != jdwpHandshake {
			t.Fatalf("got %s (len %d), want %s", string(buf), n, jdwpHandshake)
		}
	})

	// Sub-test 3: Early EOF / truncation
	t.Run("early_eof", func(t *testing.T) {
		fr := &fragmentedReader{
			data:     []byte("JDWP-"),
			maxChunk: 2,
		}
		buf := make([]byte, len(jdwpHandshake))
		_, err := io.ReadFull(fr, buf)
		if !errors.Is(err, io.ErrUnexpectedEOF) {
			t.Fatalf("expected io.ErrUnexpectedEOF, got: %v", err)
		}
	})

	// Sub-test 4: Mismatched protocol handshake (e.g. HTTP server)
	t.Run("mismatch_protocol", func(t *testing.T) {
		fr := &fragmentedReader{
			data:     []byte("HTTP/1.1 200 OK"),
			maxChunk: 4,
		}
		buf := make([]byte, len(jdwpHandshake))
		n, err := io.ReadFull(fr, buf)
		if err != nil {
			t.Fatalf("ReadFull failed: %v", err)
		}
		if n != len(jdwpHandshake) || string(buf) == jdwpHandshake {
			t.Fatalf("expected mismatch, got matching handshake")
		}
	})

	// Sub-test 5: Bidirectional net.Pipe() handshake with fragmented TCP reply
	t.Run("bidirectional_net_pipe_fragmented", func(t *testing.T) {
		clientConn, serverConn := net.Pipe()
		defer clientConn.Close()
		defer serverConn.Close()

		var wg sync.WaitGroup
		wg.Add(2)

		// Server side
		go func() {
			defer wg.Done()
			reqBuf := make([]byte, len(jdwpHandshake))
			if _, err := io.ReadFull(serverConn, reqBuf); err != nil {
				return
			}
			// Send response in 3 chunks: 3 + 3 + 8 bytes
			_, _ = serverConn.Write([]byte(jdwpHandshake[0:3]))
			_, _ = serverConn.Write([]byte(jdwpHandshake[3:6]))
			_, _ = serverConn.Write([]byte(jdwpHandshake[6:]))
		}()

		// Client side
		go func() {
			defer wg.Done()
			if _, err := io.WriteString(clientConn, jdwpHandshake); err != nil {
				return
			}
			respBuf := make([]byte, len(jdwpHandshake))
			if _, err := io.ReadFull(clientConn, respBuf); err != nil {
				t.Errorf("client ReadFull failed: %v", err)
				return
			}
			if string(respBuf) != jdwpHandshake {
				t.Errorf("handshake mismatch: got %q, want %q", string(respBuf), jdwpHandshake)
			}
		}()

		wg.Wait()
	})
}

// ── T22: Packet length and cursor boundary validation (F11) ──────────────────

func TestJDWP_PacketLengthAndCursorBoundary_T22(t *testing.T) {
	// Sub-test 1: Length < 11 (minimum header size) must be rejected before memory allocation
	lengthsUnder11 := []int32{0, 1, 5, 10}
	for _, l := range lengthsUnder11 {
		hdr := make([]byte, jdwpPacketHeaderSize)
		binary.BigEndian.PutUint32(hdr[0:4], uint32(l))
		binary.BigEndian.PutUint32(hdr[4:8], 1)
		hdr[8] = 0 // Command
		hdr[9] = 1
		hdr[10] = 1

		_, err := ReadJDWPPacket(bytes.NewReader(hdr))
		if err == nil {
			t.Fatalf("ReadJDWPPacket with length %d should have failed", l)
		}
	}

	// Sub-test 2: Length > 32MB upper bound must be rejected to prevent OOM
	lengthsOverLimit := []uint32{
		32*1024*1024 + 1,
		100 * 1024 * 1024,
		0x7FFFFFFF,
		0xFFFFFFFF,
	}
	for _, l := range lengthsOverLimit {
		hdr := make([]byte, jdwpPacketHeaderSize)
		binary.BigEndian.PutUint32(hdr[0:4], l)
		binary.BigEndian.PutUint32(hdr[4:8], 1)
		hdr[8] = 0

		_, err := ReadJDWPPacket(bytes.NewReader(hdr))
		if err == nil {
			t.Fatalf("ReadJDWPPacket with excessive length %d should have failed", l)
		}
	}

	// Sub-test 3: Minimum valid packet (length = 11, dataLen = 0)
	{
		hdr := make([]byte, jdwpPacketHeaderSize)
		binary.BigEndian.PutUint32(hdr[0:4], 11)
		binary.BigEndian.PutUint32(hdr[4:8], 42)
		hdr[8] = 0x80 // Reply
		hdr[9] = 0    // ErrCode = 0
		hdr[10] = 0

		pkt, err := ReadJDWPPacket(bytes.NewReader(hdr))
		if err != nil {
			t.Fatalf("ReadJDWPPacket length 11 failed: %v", err)
		}
		if pkt.Length != 11 || pkt.ID != 42 || len(pkt.Data) != 0 {
			t.Fatalf("unexpected packet: %+v", pkt)
		}
	}

	// Sub-test 4: Truncated payload returns unexpected EOF
	{
		hdr := make([]byte, jdwpPacketHeaderSize+5)
		binary.BigEndian.PutUint32(hdr[0:4], 11+10) // declares 10 bytes payload, but only 5 provided
		binary.BigEndian.PutUint32(hdr[4:8], 1)
		hdr[8] = 0x80

		_, err := ReadJDWPPacket(bytes.NewReader(hdr))
		if err == nil {
			t.Fatalf("expected EOF error for truncated payload, got nil")
		}
	}

	// Sub-test 5: SkipBytes negative count must be rejected
	{
		r := NewJDWPDataReader([]byte{1, 2, 3, 4})
		if err := r.SkipBytes(-1); err == nil {
			t.Fatalf("SkipBytes(-1) should return error")
		}
		if err := r.SkipBytes(-100); err == nil {
			t.Fatalf("SkipBytes(-100) should return error")
		}
		if err := r.SkipBytes(10); err == nil {
			t.Fatalf("SkipBytes past end should return error")
		}
	}

	// Sub-test 6: ReadString negative length and length exceeding data
	{
		// Negative length (-1)
		bufNeg := []byte{0xFF, 0xFF, 0xFF, 0xFF}
		rNeg := NewJDWPDataReader(bufNeg)
		if _, err := rNeg.ReadString(); err == nil {
			t.Fatalf("ReadString with negative length should return error")
		}

		// Length exceeds remaining data
		bufBig := make([]byte, 8)
		binary.BigEndian.PutUint32(bufBig[0:4], 1000) // length = 1000, only 4 bytes remain
		rBig := NewJDWPDataReader(bufBig)
		if _, err := rBig.ReadString(); err == nil {
			t.Fatalf("ReadString exceeding remaining buffer should return error")
		}
	}
}

// ── T23: Event demuxing and IDSizes negotiation (F10) ────────────────────────

func TestJDWP_EventDemuxAndIDSizes_T23(t *testing.T) {
	// Sub-test 1: Event Demuxing: VM Event arrives before command reply
	t.Run("event_demuxing_before_reply", func(t *testing.T) {
		clientConn, serverConn := net.Pipe()
		defer clientConn.Close()
		defer serverConn.Close()

		c := &JDWPConn{conn: clientConn}
		c.nextID.Store(10)

		go func() {
			// Read the command sent by client
			cmdPkt, err := ReadJDWPPacket(serverConn)
			if err != nil {
				return
			}

			// 1. Send an asynchronous VM Event packet (Flags = 0x00, e.g. CLASS_PREPARE or VM_START)
			eventPkt := &JDWPPacket{
				ID:     9999,
				Flags:  0x00, // VM Command / Event (NOT a reply)
				CmdSet: 64,   // Event command set
				Cmd:    100,
				Data:   []byte{0x01, 0x02, 0x03},
			}
			_ = WriteJDWPPacket(serverConn, eventPkt)

			// 2. Send the actual command reply for cmdPkt.ID
			replyWriter := NewJDWPDataWriter()
			replyWriter.WriteInt(1) // 1 class
			replyWriter.WriteByte(jdwpTagObject)
			replyWriter.WriteObjectID(12345)
			replyWriter.WriteInt(1) // status = prepared

			replyPkt := &JDWPPacket{
				Length:  int32(jdwpPacketHeaderSize + len(replyWriter.Bytes())),
				ID:      cmdPkt.ID,
				Flags:   0x80, // Reply
				ErrCode: 0,
				Data:    replyWriter.Bytes(),
			}
			_ = WriteJDWPPacket(serverConn, replyPkt)
		}()

		// Client sends ClassesBySignature
		classes, err := c.ClassesBySignature("Lcom/example/MyClass;")
		if err != nil {
			t.Fatalf("ClassesBySignature failed during event demuxing: %v", err)
		}
		if len(classes) != 1 {
			t.Fatalf("got %d classes, want 1", len(classes))
		}
		if classes[0].TypeID != 12345 {
			t.Fatalf("got TypeID %d, want 12345", classes[0].TypeID)
		}
	})

	// Sub-test 2: VirtualMachine.IDSizes (1,7) negotiation
	t.Run("idsizes_negotiation", func(t *testing.T) {
		clientConn, serverConn := net.Pipe()
		defer clientConn.Close()
		defer serverConn.Close()

		c := &JDWPConn{conn: clientConn}
		c.nextID.Store(20)

		go func() {
			cmdPkt, err := ReadJDWPPacket(serverConn)
			if err != nil {
				return
			}
			if cmdPkt.CmdSet != cmdSetVirtualMachine || cmdPkt.Cmd != cmdVirtualMachineIDSizes {
				return
			}

			// IDSizes reply: 5 x 4-byte integers (fieldIDSize, methodIDSize, objectIDSize, refTypeIDSize, frameIDSize)
			w := NewJDWPDataWriter()
			w.WriteInt(8) // FieldIDSize
			w.WriteInt(8) // MethodIDSize
			w.WriteInt(8) // ObjectIDSize
			w.WriteInt(8) // ReferenceTypeIDSize
			w.WriteInt(8) // FrameIDSize

			replyPkt := &JDWPPacket{
				Length:  int32(jdwpPacketHeaderSize + len(w.Bytes())),
				ID:      cmdPkt.ID,
				Flags:   0x80,
				ErrCode: 0,
				Data:    w.Bytes(),
			}
			_ = WriteJDWPPacket(serverConn, replyPkt)
		}()

		sizes, err := c.IDSizes()
		if err != nil {
			t.Fatalf("c.IDSizes() failed: %v", err)
		}
		if sizes.FieldIDSize != 8 || sizes.MethodIDSize != 8 || sizes.ObjectIDSize != 8 ||
			sizes.ReferenceTypeIDSize != 8 || sizes.FrameIDSize != 8 {
			t.Fatalf("unexpected IDSizes: %+v", sizes)
		}
		if c.idSizes.ObjectIDSize != 8 {
			t.Fatalf("cached idSizes.ObjectIDSize = %d, want 8", c.idSizes.ObjectIDSize)
		}
	})

	// Sub-test 3: ReadID and WriteID with 4-byte and 8-byte variable widths
	t.Run("read_write_variable_width_ids", func(t *testing.T) {
		// 4-byte ID
		w4 := NewJDWPDataWriter()
		w4.WriteID(123456, 4)
		if len(w4.Bytes()) != 4 {
			t.Fatalf("4-byte ID write length = %d, want 4", len(w4.Bytes()))
		}
		r4 := NewJDWPDataReader(w4.Bytes())
		id4, err := r4.ReadID(4)
		if err != nil || id4 != 123456 {
			t.Fatalf("4-byte ID read got %d, err %v", id4, err)
		}

		// 8-byte ID
		w8 := NewJDWPDataWriter()
		w8.WriteID(9876543210, 8)
		if len(w8.Bytes()) != 8 {
			t.Fatalf("8-byte ID write length = %d, want 8", len(w8.Bytes()))
		}
		r8 := NewJDWPDataReader(w8.Bytes())
		id8, err := r8.ReadID(8)
		if err != nil || id8 != 9876543210 {
			t.Fatalf("8-byte ID read got %d, err %v", id8, err)
		}

		// Invalid sizes must return error and not panic or loop
		for _, badSize := range []int{0, -1, 1, 2, 3, 5, 6, 7, 9, 16} {
			rBad := NewJDWPDataReader([]byte{1, 2, 3, 4, 5, 6, 7, 8})
			_, err := rBad.ReadID(badSize)
			if err == nil {
				t.Fatalf("ReadID(%d) should have failed with error, but succeeded", badSize)
			}
		}

		// Nil writer safety for WriteTaggedValue
		var nilWriter *JDWPDataWriter
		nilWriter.WriteTaggedValue(jdwpTagInt, 42) // must not panic
	})
}

// ── T24: Official Oracle JDWP error code table golden test (F12) ─────────────

func TestJDWP_OracleErrorCodesGoldenTable_T24(t *testing.T) {
	// Independent authoritative Oracle JDWP specification test oracle
	goldenCodes := []struct {
		code int16
		want string
	}{
		{0, "NONE"},
		{10, "INVALID_THREAD"},
		{11, "INVALID_THREAD_GROUP"},
		{12, "INVALID_PRIORITY"},
		{13, "THREAD_NOT_SUSPENDED"},
		{14, "THREAD_SUSPENDED"},
		{15, "THREAD_NOT_ALIVE"},
		{20, "INVALID_OBJECT"},
		{21, "INVALID_CLASS"},
		{22, "CLASS_NOT_PREPARED"},
		{23, "INVALID_METHODID"},
		{24, "INVALID_LOCATION"},
		{25, "INVALID_FIELDID"},
		{30, "INVALID_FRAMEID"},
		{31, "NO_MORE_FRAMES"},
		{32, "OPAQUE_FRAME"},
		{33, "NOT_CURRENT_FRAME"},
		{34, "TYPE_MISMATCH"},
		{35, "INVALID_SLOT"},
		{40, "DUPLICATE"},
		{41, "NOT_FOUND"},
		{50, "INVALID_MONITOR"},
		{51, "NOT_MONITOR_OWNER"},
		{52, "INTERRUPT"},
		{60, "INVALID_CLASS_FORMAT"},
		{61, "CIRCULAR_CLASS_DEFINITION"},
		{62, "FAILS_VERIFICATION"},
		{63, "ADD_METHOD_NOT_IMPLEMENTED"},
		{64, "SCHEMA_CHANGE_NOT_IMPLEMENTED"},
		{65, "INVALID_TYPESTATE"},
		{66, "HIERARCHY_CHANGE_NOT_IMPLEMENTED"},
		{67, "DELETE_METHOD_NOT_IMPLEMENTED"},
		{68, "CLASS_MODIFIERS_CHANGE_NOT_IMPLEMENTED"},
		{69, "METHOD_MODIFIERS_CHANGE_NOT_IMPLEMENTED"},
		{99, "NOT_IMPLEMENTED"},
		{100, "NULL_POINTER"},
		{101, "ABSENT_INFORMATION"},
		{102, "INVALID_EVENT_TYPE"},
		{103, "ILLEGAL_ARGUMENT"},
		{110, "OUT_OF_MEMORY"},
		{111, "ACCESS_DENIED"},
		{112, "VM_DEAD"},
		{113, "INTERNAL"},
		{115, "UNATTACHED_THREAD"},
		{500, "INVALID_TAG"},
		{502, "ALREADY_INVOKING"},
		{503, "INVALID_INDEX"},
		{504, "INVALID_LENGTH"},
		{506, "INVALID_STRING"},
		{507, "INVALID_CLASS_LOADER"},
		{508, "INVALID_ARRAY"},
		{510, "TRANSPORT_LOAD"},
		{511, "TRANSPORT_INIT"},
		{512, "NATIVE_METHOD"},
		{513, "INVALID_COUNT"},
	}

	for _, tc := range goldenCodes {
		got := jdwpErrorMessage(tc.code)
		if got != tc.want {
			t.Errorf("code %d: got %q, want %q", tc.code, got, tc.want)
		}
	}

	// Critical negative assertions verifying that old scrambled mappings are gone:
	if jdwpErrorMessage(10) == "VM_DEAD" {
		t.Errorf("code 10 must NOT map to VM_DEAD (should be INVALID_THREAD)")
	}
	if jdwpErrorMessage(112) == "NO_MORE_FRAMES" {
		t.Errorf("code 112 must NOT map to NO_MORE_FRAMES (should be VM_DEAD)")
	}
	if jdwpErrorMessage(20) == "INVALID_CLASS" {
		t.Errorf("code 20 must NOT map to INVALID_CLASS (should be INVALID_OBJECT)")
	}
	if jdwpErrorMessage(30) == "INVALID_LENGTH" {
		t.Errorf("code 30 must NOT map to INVALID_LENGTH (should be INVALID_FRAMEID)")
	}

	// Unknown error codes must preserve raw integer value without mislabeling
	unknownCode := int16(777)
	if got := jdwpErrorMessage(unknownCode); got != "UNKNOWN_ERROR_777" {
		t.Errorf("unknown error code %d: got %q, want UNKNOWN_ERROR_777", unknownCode, got)
	}
}
