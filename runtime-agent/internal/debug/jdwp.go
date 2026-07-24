// Package debug — JDWP protocol low-level helpers.
//
// JDWP (Java Debug Wire Protocol) is a binary protocol used by the JVM
// debugger agent. This file implements the packet format, command/reply
// encoding, and basic type reading/writing helpers.
//
// Reference: https://docs.oracle.com/javase/6/docs/technotes/guides/jpda/jdwp/jdwp-protocol.html
package debug

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
)

// JDWP packet constants.
const (
	jdwpPacketHeaderSize = 11

	// JDWP command set identifiers.
	cmdSetVirtualMachine = 1
	cmdSetReferenceType  = 2
	cmdSetClassType      = 3
	cmdSetArrayType      = 4
	cmdSetField          = 8
	cmdSetMethod         = 9
	cmdSetObjectReference = 9
	cmdSetStringReference = 10
	cmdSetThreadReference = 11
	cmdSetThreadGroupRef  = 12
	cmdSetArrayReference  = 13
	cmdSetClassLoaderRef  = 14
	cmdSetEventRequest    = 15
	cmdSetStackFrame      = 16
	cmdSetClassObjectRef  = 17

	// Event kinds.
	eventKindBreakpoint          = 2
	eventKindFieldAccess         = 20
	eventKindFieldModification   = 21
	eventKindException           = 4
	eventKindClassPrepare        = 8
	eventKindClassUnload         = 9
	eventKindThreadStart         = 6
	eventKindThreadDeath         = 7
	eventKindVMDeath             = 99
	eventKindVMStart             = 90

	// Suspend policies.
	suspendNone     = 0
	suspendEventThread = 1
	suspendAll       = 2

	// JDWP tag constants for value types.
	jdwpTagByte      = 'B'
	jdwpTagChar      = 'C'
	jdwpTagDouble    = 'D'
	jdwpTagFloat     = 'F'
	jdwpTagInt       = 'I'
	jdwpTagLong      = 'J'
	jdwpTagShort     = 'S'
	jdwpTagBoolean   = 'Z'
	jdwpTagString    = 's'
	jdwpTagArray     = '['
	jdwpTagObject    = 'L'
	jdwpTagThread    = 't'
	jdwpTagThreadGroup = 'g'
	jdwpTagClassLoader = 'l'
	jdwpTagClassObject = 'c'
	jdwpTagVoid      = 'V'
)

// JDWPPacket represents a raw JDWP packet.
type JDWPPacket struct {
	Length    int32
	ID        int32
	Flags     byte
	CmdSet    byte
	Cmd       byte
	ErrCode   int16
	Data      []byte
}

// JDWPError is a JDWP protocol-level error.
type JDWPError struct {
	ErrCode int16
	Msg     string
}

func (e *JDWPError) Error() string {
	return fmt.Sprintf("JDWP error %d: %s", e.ErrCode, e.Msg)
}

// WriteJDWPPacket writes a JDWP packet to the writer.
func WriteJDWPPacket(w io.Writer, pkt *JDWPPacket) error {
	header := make([]byte, jdwpPacketHeaderSize)
	dataLen := int32(len(pkt.Data))
	binary.BigEndian.PutUint32(header[0:4], uint32(jdwpPacketHeaderSize+dataLen))
	binary.BigEndian.PutUint32(header[4:8], uint32(pkt.ID))
	header[8] = pkt.Flags
	header[9] = pkt.CmdSet
	header[10] = pkt.Cmd
	if _, err := w.Write(header); err != nil {
		return err
	}
	if len(pkt.Data) > 0 {
		if _, err := w.Write(pkt.Data); err != nil {
			return err
		}
	}
	return nil
}

// ReadJDWPPacket reads a JDWP packet from the reader.
func ReadJDWPPacket(r io.Reader) (*JDWPPacket, error) {
	header := make([]byte, jdwpPacketHeaderSize)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, fmt.Errorf("read JDWP header: %w", err)
	}
	pkt := &JDWPPacket{
		Length: int32(binary.BigEndian.Uint32(header[0:4])),
		ID:     int32(binary.BigEndian.Uint32(header[4:8])),
		Flags:  header[8],
	}

	if pkt.Flags == 0x80 {
		// Reply packet: error code is in the first 2 bytes of data.
		pkt.ErrCode = int16(binary.BigEndian.Uint16(header[9:11]))
		dataLen := pkt.Length - jdwpPacketHeaderSize
		if dataLen > 0 {
			pkt.Data = make([]byte, dataLen)
			if _, err := io.ReadFull(r, pkt.Data); err != nil {
				return nil, fmt.Errorf("read JDWP reply data: %w", err)
			}
		}
		if pkt.ErrCode != 0 {
			return pkt, &JDWPError{ErrCode: pkt.ErrCode, Msg: jdwpErrorMessage(pkt.ErrCode)}
		}
	} else {
		// Command packet.
		pkt.CmdSet = header[9]
		pkt.Cmd = header[10]
		dataLen := pkt.Length - jdwpPacketHeaderSize
		if dataLen > 0 {
			pkt.Data = make([]byte, dataLen)
			if _, err := io.ReadFull(r, pkt.Data); err != nil {
				return nil, fmt.Errorf("read JDWP command data: %w", err)
			}
		}
	}
	return pkt, nil
}

// JDWPDataReader is a helper for reading data from a JDWP packet payload.
type JDWPDataReader struct {
	data []byte
	pos  int
}

// NewJDWPDataReader creates a new reader from a byte slice.
func NewJDWPDataReader(data []byte) *JDWPDataReader {
	return &JDWPDataReader{data: data, pos: 0}
}

// ReadByte reads a single byte.
func (r *JDWPDataReader) ReadByte() (byte, error) {
	if r.pos >= len(r.data) {
		return 0, fmt.Errorf("JDWP read: unexpected end of data at position %d", r.pos)
	}
	b := r.data[r.pos]
	r.pos++
	return b, nil
}

// ReadBool reads a boolean.
func (r *JDWPDataReader) ReadBool() (bool, error) {
	b, err := r.ReadByte()
	if err != nil {
		return false, err
	}
	return b != 0, nil
}

// ReadInt reads a 4-byte signed integer.
func (r *JDWPDataReader) ReadInt() (int32, error) {
	if r.pos+4 > len(r.data) {
		return 0, fmt.Errorf("JDWP read int: unexpected end of data")
	}
	v := int32(binary.BigEndian.Uint32(r.data[r.pos : r.pos+4]))
	r.pos += 4
	return v, nil
}

// ReadLong reads an 8-byte signed long.
func (r *JDWPDataReader) ReadLong() (int64, error) {
	if r.pos+8 > len(r.data) {
		return 0, fmt.Errorf("JDWP read long: unexpected end of data")
	}
	v := int64(binary.BigEndian.Uint64(r.data[r.pos : r.pos+8]))
	r.pos += 8
	return v, nil
}

// ReadObjectID reads an 8-byte object ID.
func (r *JDWPDataReader) ReadObjectID() (int64, error) {
	return r.ReadLong()
}

// ReadFrameID reads an 8-byte frame ID.
func (r *JDWPDataReader) ReadFrameID() (int64, error) {
	return r.ReadLong()
}

// ReadString reads a UTF-8 string (length-prefixed with 4 bytes).
func (r *JDWPDataReader) ReadString() (string, error) {
	length, err := r.ReadInt()
	if err != nil {
		return "", err
	}
	if length < 0 {
		return "", fmt.Errorf("JDWP read string: negative length %d", length)
	}
	if r.pos+int(length) > len(r.data) {
		return "", fmt.Errorf("JDWP read string: unexpected end of data")
	}
	s := string(r.data[r.pos : r.pos+int(length)])
	r.pos += int(length)
	return s, nil
}

// ReadUntaggedValue reads a value without a tag byte.
func (r *JDWPDataReader) ReadUntaggedValue(tag byte) (interface{}, error) {
	switch tag {
	case jdwpTagByte:
		b, err := r.ReadByte()
		return int8(b), err
	case jdwpTagChar:
		v, err := r.ReadInt()
		return uint16(v), err
	case jdwpTagDouble:
		return r.ReadDouble()
	case jdwpTagFloat:
		return r.ReadFloat()
	case jdwpTagInt:
		return r.ReadInt()
	case jdwpTagLong:
		return r.ReadLong()
	case jdwpTagShort:
		v, err := r.ReadInt()
		return int16(v), err
	case jdwpTagBoolean:
		return r.ReadBool()
	case jdwpTagString, jdwpTagArray, jdwpTagObject, jdwpTagThread,
		jdwpTagThreadGroup, jdwpTagClassLoader, jdwpTagClassObject:
		return r.ReadObjectID()
	default:
		return nil, fmt.Errorf("JDWP: unknown value tag '%c' (0x%x)", tag, tag)
	}
}

// ReadDouble reads an 8-byte IEEE 754 double.
func (r *JDWPDataReader) ReadDouble() (float64, error) {
	if r.pos+8 > len(r.data) {
		return 0, fmt.Errorf("JDWP read double: unexpected end of data")
	}
	bits := binary.BigEndian.Uint64(r.data[r.pos : r.pos+8])
	r.pos += 8
	return float64FromBits(bits), nil
}

// ReadFloat reads a 4-byte IEEE 754 float.
func (r *JDWPDataReader) ReadFloat() (float32, error) {
	if r.pos+4 > len(r.data) {
		return 0, fmt.Errorf("JDWP read float: unexpected end of data")
	}
	bits := binary.BigEndian.Uint32(r.data[r.pos : r.pos+4])
	r.pos += 4
	return float32FromBits(bits), nil
}

// ReadTaggedValue reads a tag byte followed by the value.
func (r *JDWPDataReader) ReadTaggedValue() (byte, interface{}, error) {
	tag, err := r.ReadByte()
	if err != nil {
		return 0, nil, err
	}
	val, err := r.ReadUntaggedValue(tag)
	return tag, val, err
}

// SkipBytes skips n bytes.
func (r *JDWPDataReader) SkipBytes(n int) error {
	if r.pos+n > len(r.data) {
		return fmt.Errorf("JDWP skip: unexpected end of data")
	}
	r.pos += n
	return nil
}

// Remaining returns the number of unread bytes.
func (r *JDWPDataReader) Remaining() int {
	if r.pos >= len(r.data) {
		return 0
	}
	return len(r.data) - r.pos
}

// JDWPDataWriter is a helper for writing JDWP command data.
type JDWPDataWriter struct {
	data []byte
}

// NewJDWPDataWriter creates a new writer.
func NewJDWPDataWriter() *JDWPDataWriter {
	return &JDWPDataWriter{}
}

// WriteByte writes a single byte.
func (w *JDWPDataWriter) WriteByte(b byte) error {
	w.data = append(w.data, b)
	return nil
}

// WriteInt writes a 4-byte integer.
func (w *JDWPDataWriter) WriteInt(v int32) {
	buf := make([]byte, 4)
	binary.BigEndian.PutUint32(buf, uint32(v))
	w.data = append(w.data, buf...)
}

// WriteLong writes an 8-byte long.
func (w *JDWPDataWriter) WriteLong(v int64) {
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, uint64(v))
	w.data = append(w.data, buf...)
}

// WriteObjectID writes an 8-byte object ID.
func (w *JDWPDataWriter) WriteObjectID(id int64) {
	w.WriteLong(id)
}

// WriteString writes a UTF-8 string (length-prefixed with 4 bytes).
func (w *JDWPDataWriter) WriteString(s string) {
	w.WriteInt(int32(len(s)))
	w.data = append(w.data, []byte(s)...)
}

// WriteTaggedValue writes a tag byte followed by the value.
func (w *JDWPDataWriter) WriteTaggedValue(tag byte, value interface{}) {
	w.WriteByte(tag)
	switch tag {
	case jdwpTagByte:
		w.WriteByte(byte(value.(int8)))
	case jdwpTagChar:
		w.WriteInt(int32(value.(uint16)))
	case jdwpTagDouble:
		w.WriteDouble(value.(float64))
	case jdwpTagFloat:
		w.WriteFloat(value.(float32))
	case jdwpTagInt:
		w.WriteInt(value.(int32))
	case jdwpTagLong:
		w.WriteLong(value.(int64))
	case jdwpTagShort:
		w.WriteInt(int32(value.(int16)))
	case jdwpTagBoolean:
		if value.(bool) {
			w.WriteByte(1)
		} else {
			w.WriteByte(0)
		}
	case jdwpTagString, jdwpTagArray, jdwpTagObject, jdwpTagThread,
		jdwpTagThreadGroup, jdwpTagClassLoader, jdwpTagClassObject:
		w.WriteObjectID(value.(int64))
	}
}

// WriteDouble writes an 8-byte IEEE 754 double.
func (w *JDWPDataWriter) WriteDouble(v float64) {
	buf := make([]byte, 8)
	binary.BigEndian.PutUint64(buf, float64ToBits(v))
	w.data = append(w.data, buf...)
}

// WriteFloat writes a 4-byte IEEE 754 float.
func (w *JDWPDataWriter) WriteFloat(v float32) {
	buf := make([]byte, 4)
	binary.BigEndian.PutUint32(buf, float32ToBits(v))
	w.data = append(w.data, buf...)
}

// Bytes returns the accumulated data.
func (w *JDWPDataWriter) Bytes() []byte {
	return w.data
}

func float64FromBits(bits uint64) float64 {
	return math.Float64frombits(bits)
}

func float64ToBits(v float64) uint64 {
	return math.Float64bits(v)
}

func float32FromBits(bits uint32) float32 {
	return math.Float32frombits(bits)
}

func float32ToBits(v float32) uint32 {
	return math.Float32bits(v)
}

// jdwpErrorMessage returns a human-readable error message for a JDWP error code.
func jdwpErrorMessage(code int16) string {
	switch code {
	case 10:
		return "VM_DEAD"
	case 11:
		return "THREAD_NOT_SUSPENDED"
	case 20:
		return "INVALID_CLASS"
	case 21:
		return "INVALID_CLASS_FORMAT"
	case 22:
		return "INVALID_CLASS_LOADER"
	case 23:
		return "INVALID_FIELDID"
	case 24:
		return "INVALID_FRAMEID"
	case 25:
		return "INVALID_INTERFACE"
	case 30:
		return "INVALID_LENGTH"
	case 31:
		return "INVALID_LOCATION"
	case 32:
		return "INVALID_METHODID"
	case 33:
		return "INVALID_OBJECT"
	case 34:
		return "INVALID_STRING"
	case 35:
		return "INVALID_THREAD"
	case 36:
		return "INVALID_THREAD_GROUP"
	case 40:
		return "INVALID_SLOT"
	case 41:
		return "INVALID_TAG"
	case 42:
		return "INVALID_ARRAY"
	case 50:
		return "TYPE_MISMATCH"
	case 60:
		return "INVALID_EVENT_TYPE"
	case 99:
		return "NOT_IMPLEMENTED"
	case 100:
		return "ABSENT_INFORMATION"
	case 101:
		return "INVALID_TYPESTATE"
	case 110:
		return "NATIVE_METHOD"
	case 111:
		return "OPAQUE_FRAME"
	case 112:
		return "NO_MORE_FRAMES"
	default:
		return fmt.Sprintf("UNKNOWN_ERROR_%d", code)
	}
}