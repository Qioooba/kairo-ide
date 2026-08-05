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
	"net"
	"strconv"
	"sync/atomic"
	"time"
)

const (
	cmdVirtualMachineClassesBySignature = 2
	cmdVirtualMachineRedefineClasses    = 18
)

// ClassRef is a loaded reference type returned by ClassesBySignature.
type ClassRef struct {
	RefTypeTag byte
	TypeID     int64
	Status     int32
}

// JDWPConn is a short-lived exclusive JDWP client connection.
type JDWPConn struct {
	conn   net.Conn
	nextID atomic.Int32
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
	if _, err := conn.Write([]byte(jdwpHandshake)); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("JDWP handshake write: %w", err)
	}
	buf := make([]byte, len(jdwpHandshake))
	if _, err := conn.Read(buf); err != nil {
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

// ClassesBySignature issues VirtualMachine.ClassesBySignature (1,2).
func (c *JDWPConn) ClassesBySignature(signature string) ([]ClassRef, error) {
	w := NewJDWPDataWriter()
	w.WriteString(signature)
	reply, err := c.send(cmdSetVirtualMachine, cmdVirtualMachineClassesBySignature, w.Bytes())
	if err != nil {
		return nil, err
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
		typeID, err := r.ReadObjectID()
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
	data := BuildRedefineClassesCommand(classes)
	_, err := c.send(cmdSetVirtualMachine, cmdVirtualMachineRedefineClasses, data)
	return err
}

func (c *JDWPConn) send(cmdSet, cmd byte, data []byte) (*JDWPPacket, error) {
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
	reply, err := ReadJDWPPacket(c.conn)
	if err != nil {
		return nil, fmt.Errorf("JDWP reply: %w", err)
	}
	if reply.ID != id {
		return nil, fmt.Errorf("JDWP reply id mismatch: got %d want %d", reply.ID, id)
	}
	if reply.ErrCode != 0 {
		return reply, &JDWPError{ErrCode: reply.ErrCode, Msg: jdwpErrorMessage(reply.ErrCode)}
	}
	return reply, nil
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
