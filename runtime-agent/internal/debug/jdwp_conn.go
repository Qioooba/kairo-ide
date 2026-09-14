// Package debug - live JDWP TCP client for RedefineClasses (BD-P1-4).
//
// Connects to a JDWP listener, looks up classes by JNI signature, and
// issues VirtualMachine.RedefineClasses. Intended for exclusive JDWP
// access (e.g. Tomcat started with JDWP but no DAP attached). When a
// debugger already owns the port, Dial fails or Redefine returns a
// clear JDWP error - callers must surface that honestly.
package debug

import (
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

const (
	cmdVirtualMachineClassesBySignature = 2
	cmdVirtualMachineIDSizes            = 7
	cmdVirtualMachineRedefineClasses    = 18
)

// ClassRef is a loaded reference type returned by ClassesBySignature.
type ClassRef struct {
	RefTypeTag byte
	TypeID     int64
	Status     int32
}

// JDWPIDSizes holds the sizes (in bytes) of variable-length IDs negotiated with the JVM (F10 / T23).
type JDWPIDSizes struct {
	FieldIDSize         int32
	MethodIDSize        int32
	ObjectIDSize        int32
	ReferenceTypeIDSize int32
	FrameIDSize         int32
}

// JDWPClient defines the minimal interface for live JDWP class inspection and redefinition (PR05 / PR06).
type JDWPClient interface {
	IDSizes() (JDWPIDSizes, error)
	ClassesBySignature(signature string) ([]ClassRef, error)
	GetClassLoader(typeID int64) (int64, error)
	RedefineClasses(classes []ClassRedefinition) error
	Close() error
}

// JDWPConn is a short-lived exclusive JDWP client connection.
type JDWPConn struct {
	conn    net.Conn
	mu      sync.Mutex
	nextID  atomic.Int32
	idSizes JDWPIDSizes
}

// DialJDWP opens a TCP connection, completes the JDWP handshake, and
// returns a ready client. Caller must Close.
func DialJDWP(host string, port int, timeout time.Duration) (*JDWPConn, error) {
	if host == "" {
		host = "127.0.0.1"
	}
	if port <= 0 || port > 65535 {
		return nil, fmt.Errorf("invalid JDWP port %d", port)
	}
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return nil, fmt.Errorf("dial JDWP %s: %w", addr, err)
	}
	_ = conn.SetDeadline(time.Now().Add(timeout))
	if _, err := io.WriteString(conn, jdwpHandshake); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("JDWP handshake write: %w", err)
	}
	buf := make([]byte, len(jdwpHandshake))
	if _, err := io.ReadFull(conn, buf); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("JDWP handshake read: %w", err)
	}
	if string(buf) != jdwpHandshake {
		_ = conn.Close()
		return nil, fmt.Errorf("JDWP handshake mismatch: %q", string(buf))
	}
	_ = conn.SetDeadline(time.Time{})
	c := &JDWPConn{conn: conn}
	c.nextID.Store(1)
	return c, nil
}

// Close closes the underlying TCP connection.
func (c *JDWPConn) Close() error {
	if c == nil || c.conn == nil {
		return nil
	}
	return c.conn.Close()
}

// IDSizes issues VirtualMachine.IDSizes (1,7) to negotiate target ID sizes (F10 / T23).
func (c *JDWPConn) IDSizes() (JDWPIDSizes, error) {
	reply, err := c.send(cmdSetVirtualMachine, cmdVirtualMachineIDSizes, nil)
	if err != nil {
		return JDWPIDSizes{}, fmt.Errorf("VirtualMachine.IDSizes: %w", err)
	}
	r := NewJDWPDataReader(reply.Data)
	fieldIDSize, err := r.ReadInt()
	if err != nil {
		return JDWPIDSizes{}, fmt.Errorf("read FieldIDSize: %w", err)
	}
	methodIDSize, err := r.ReadInt()
	if err != nil {
		return JDWPIDSizes{}, fmt.Errorf("read MethodIDSize: %w", err)
	}
	objectIDSize, err := r.ReadInt()
	if err != nil {
		return JDWPIDSizes{}, fmt.Errorf("read ObjectIDSize: %w", err)
	}
	refTypeIDSize, err := r.ReadInt()
	if err != nil {
		return JDWPIDSizes{}, fmt.Errorf("read ReferenceTypeIDSize: %w", err)
	}
	frameIDSize, err := r.ReadInt()
	if err != nil {
		return JDWPIDSizes{}, fmt.Errorf("read FrameIDSize: %w", err)
	}
	sizes := JDWPIDSizes{
		FieldIDSize:         fieldIDSize,
		MethodIDSize:        methodIDSize,
		ObjectIDSize:        objectIDSize,
		ReferenceTypeIDSize: refTypeIDSize,
		FrameIDSize:         frameIDSize,
	}
	c.idSizes = sizes
	return sizes, nil
}

// ClassesBySignature issues VirtualMachine.ClassesBySignature (1,2).
func (c *JDWPConn) ClassesBySignature(signature string) ([]ClassRef, error) {
	w := NewJDWPDataWriter()
	w.WriteString(signature)
	reply, err := c.send(cmdSetVirtualMachine, cmdVirtualMachineClassesBySignature, w.Bytes())
	if err != nil {
		return nil, err
	}
	refSize := int(c.idSizes.ReferenceTypeIDSize)
	if refSize != 4 && refSize != 8 {
		refSize = 8
	}
	r := NewJDWPDataReader(reply.Data)
	count, err := r.ReadInt()
	if err != nil {
		return nil, fmt.Errorf("ClassesBySignature count: %w", err)
	}
	out := make([]ClassRef, 0, count)
	for i := int32(0); i < count; i++ {
		tag, err := r.ReadByte()
		if err != nil {
			return nil, err
		}
		typeID, err := r.ReadID(refSize)
		if err != nil {
			return nil, err
		}
		status, err := r.ReadInt()
		if err != nil {
			return nil, err
		}
		out = append(out, ClassRef{RefTypeTag: tag, TypeID: typeID, Status: status})
	}
	return out, nil
}

// RedefineClasses issues VirtualMachine.RedefineClasses (1,18).
func (c *JDWPConn) RedefineClasses(classes []ClassRedefinition) error {
	if len(classes) == 0 {
		return fmt.Errorf("no classes to redefine")
	}
	refSize := int(c.idSizes.ReferenceTypeIDSize)
	if refSize != 4 && refSize != 8 {
		refSize = 8
	}
	data := BuildRedefineClassesCommandWithSizes(classes, refSize)
	_, err := c.send(cmdSetVirtualMachine, cmdVirtualMachineRedefineClasses, data)
	return err
}

// GetClassLoader issues ReferenceType.ClassLoader (2,2) to query the class loader object ID (PR05 / F06).
func (c *JDWPConn) GetClassLoader(typeID int64) (int64, error) {
	refSize := int(c.idSizes.ReferenceTypeIDSize)
	if refSize != 4 && refSize != 8 {
		refSize = 8
	}
	objSize := int(c.idSizes.ObjectIDSize)
	if objSize != 4 && objSize != 8 {
		objSize = 8
	}
	w := NewJDWPDataWriter()
	w.WriteID(typeID, refSize)
	reply, err := c.send(cmdSetReferenceType, 2, w.Bytes())
	if err != nil {
		return 0, fmt.Errorf("ReferenceType.ClassLoader(%d): %w", typeID, err)
	}
	r := NewJDWPDataReader(reply.Data)
	loaderID, err := r.ReadID(objSize)
	if err != nil {
		return 0, fmt.Errorf("read ClassLoaderID: %w", err)
	}
	return loaderID, nil
}

func (c *JDWPConn) send(cmdSet, cmd byte, data []byte) (*JDWPPacket, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	id := c.nextID.Add(1)
	_ = c.conn.SetDeadline(time.Now().Add(15 * time.Second))
	pkt := &JDWPPacket{
		ID:     id,
		Flags:  0,
		CmdSet: cmdSet,
		Cmd:    cmd,
		Data:   data,
	}
	if err := WriteJDWPPacket(c.conn, pkt); err != nil {
		return nil, fmt.Errorf("JDWP send: %w", err)
	}
	for {
		reply, err := ReadJDWPPacket(c.conn)
		if err != nil {
			return nil, fmt.Errorf("JDWP reply: %w", err)
		}
		// Event demuxing: JVM commands/events have Flags & 0x80 == 0.
		// Asynchronous events from VM should be skipped while waiting for command reply (F10 / T23).
		if reply.Flags&0x80 == 0 {
			continue
		}
		if reply.ID != id {
			if reply.ID < id {
				continue
			}
			return nil, fmt.Errorf("JDWP reply id mismatch: got %d want %d", reply.ID, id)
		}
		if reply.ErrCode != 0 {
			return reply, &JDWPError{ErrCode: reply.ErrCode, Msg: jdwpErrorMessage(reply.ErrCode)}
		}
		return reply, nil
	}
}

// JNISignatureFromBinaryName converts com.example.Foo to Lcom/example/Foo;.
func JNISignatureFromBinaryName(binaryName string) string {
	if binaryName == "" {
		return ""
	}
	out := make([]byte, 0, len(binaryName)+3)
	out = append(out, 'L')
	for i := 0; i < len(binaryName); i++ {
		ch := binaryName[i]
		if ch == '.' {
			out = append(out, '/')
		} else {
			out = append(out, ch)
		}
	}
	out = append(out, ';')
	return string(out)
}

// ClassVersionFromBytes extracts major.minor packed as (major<<16)|minor.
func ClassVersionFromBytes(classBytes []byte) int32 {
	if len(classBytes) < 8 {
		return 0
	}
	minor := int32(binary.BigEndian.Uint16(classBytes[4:6]))
	major := int32(binary.BigEndian.Uint16(classBytes[6:8]))
	return (major << 16) | minor
}
