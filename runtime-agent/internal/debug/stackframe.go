// Package debug — stack frame navigation over JDWP.
//
// Implements parsing of JDWP thread frame and stack frame responses,
// including local variable enumeration, source location lookup, and
// frame navigation (up/down the call stack).
package debug

import (
	"fmt"
)

// StackFrame represents a single stack frame from a suspended thread.
type StackFrame struct {
	FrameID     int64  `json:"frameId"`
	ClassName   string `json:"className"`
	MethodName  string `json:"methodName"`
	SourceFile  string `json:"sourceFile"`
	LineNumber  int32  `json:"lineNumber"`
	IsNative    bool   `json:"isNative"`
	IsOpaque    bool   `json:"isOpaque"`
	IsObsolete  bool   `json:"isObsolete"`
	Index       int    `json:"index"`
}

// StackFrameList is a list of stack frames with metadata.
type StackFrameList struct {
	Frames    []*StackFrame `json:"frames"`
	ThreadID  int64         `json:"threadId"`
	Count     int           `json:"count"`
}

// FrameLocation holds source location information for a frame.
type FrameLocation struct {
	SourceFile string `json:"sourceFile"`
	LineNumber int32  `json:"lineNumber"`
	ClassName  string `json:"className"`
	MethodName string `json:"methodName"`
}

// ThreadInfo holds basic thread information.
type ThreadInfo struct {
	ThreadID   int64  `json:"threadId"`
	Name       string `json:"name"`
	Status     int32  `json:"status"`
	IsSuspended bool   `json:"isSuspended"`
	FrameCount int32  `json:"frameCount"`
}

// ThreadList is a list of threads.
type ThreadList struct {
	Threads []*ThreadInfo `json:"threads"`
	Count   int           `json:"count"`
}

// ThreadStatus constants from JDWP.
const (
	ThreadStatusZombie    = 0
	ThreadStatusRunning   = 1
	ThreadStatusSleeping  = 2
	ThreadStatusMonitor   = 3
	ThreadStatusWait      = 4
)

// ThreadStatusName returns a human-readable name for a thread status.
func ThreadStatusName(status int32) string {
	switch status {
	case ThreadStatusZombie:
		return "zombie"
	case ThreadStatusRunning:
		return "running"
	case ThreadStatusSleeping:
		return "sleeping"
	case ThreadStatusMonitor:
		return "monitor"
	case ThreadStatusWait:
		return "wait"
	default:
		return fmt.Sprintf("unknown(%d)", status)
	}
}

// ── Stack Frame Parsing ────────────────────────────────────────

// ParseStackFrames parses a JDWP ThreadReference.Frames reply.
//
// Reply format:
//
//	[int: frame count]
//	[for each frame:
//	  long: frameID
//	  Location:
//	    byte: tag
//	    long: classID
//	    long: methodID
//	    long: index (8 bytes in JDWP)]
func ParseStackFrames(data []byte, threadID int64) (*StackFrameList, error) {
	r := NewJDWPDataReader(data)
	count, err := r.ReadInt()
	if err != nil {
		return nil, fmt.Errorf("parse frame count: %w", err)
	}

	result := &StackFrameList{
		Frames:   make([]*StackFrame, 0, count),
		ThreadID: threadID,
		Count:    int(count),
	}

	for i := int32(0); i < count; i++ {
		frame, err := parseSingleFrame(r, int(i))
		if err != nil {
			return nil, fmt.Errorf("parse frame %d: %w", i, err)
		}
		result.Frames = append(result.Frames, frame)
	}

	return result, nil
}

// parseSingleFrame reads a single frame from the JDWP data.
func parseSingleFrame(r *JDWPDataReader, index int) (*StackFrame, error) {
	frameID, err := r.ReadFrameID()
	if err != nil {
		return nil, fmt.Errorf("read frameID: %w", err)
	}

	// Read Location: tag (1 byte), classID (8 bytes), methodID (8 bytes), index (8 bytes)
	tag, err := r.ReadByte()
	if err != nil {
		return nil, fmt.Errorf("read location tag: %w", err)
	}

	classID, err := r.ReadObjectID()
	if err != nil {
		return nil, fmt.Errorf("read classID: %w", err)
	}

	methodID, err := r.ReadObjectID()
	if err != nil {
		return nil, fmt.Errorf("read methodID: %w", err)
	}

	// JDWP: method index is a long (8 bytes)
	methodIndex, err := r.ReadLong()
	if err != nil {
		return nil, fmt.Errorf("read method index: %w", err)
	}

	frame := &StackFrame{
		FrameID: frameID,
		Index:   index,
	}

	_ = classID
	_ = methodID
	_ = methodIndex
	_ = tag

	return frame, nil
}

// ParseFrameLocations enriches frames with source location data
// parsed from the JDWP ReferenceType.SourceFile and
// ReferenceType.Methods replies.
func ParseFrameLocations(frames []*StackFrame, classData map[int64]*ClassLocationInfo) error {
	for _, frame := range frames {
		info := classData[frame.FrameID]
		if info != nil {
			frame.ClassName = info.ClassName
			frame.MethodName = info.MethodName
			frame.SourceFile = info.SourceFile
			frame.LineNumber = info.LineNumber
		}
	}
	return nil
}

// ClassLocationInfo holds class-level source location data.
type ClassLocationInfo struct {
	ClassName  string
	MethodName string
	SourceFile string
	LineNumber int32
	ClassID    int64
	MethodID   int64
}

// ParseSourceFile parses a JDWP ReferenceType.SourceFile reply.
//
// Reply format:
//
//	[string: source file name]
func ParseSourceFile(data []byte) (string, error) {
	r := NewJDWPDataReader(data)
	return r.ReadString()
}

// ── Thread Parsing ──────────────────────────────────────────────

// ParseThreadList parses a JDWP VirtualMachine.AllThreads reply.
//
// Reply format:
//
//	[int: thread count]
//	[for each thread:
//	  long: threadID]
func ParseThreadList(data []byte, threadNames map[int64]string) (*ThreadList, error) {
	r := NewJDWPDataReader(data)
	count, err := r.ReadInt()
	if err != nil {
		return nil, fmt.Errorf("parse thread count: %w", err)
	}

	result := &ThreadList{
		Threads: make([]*ThreadInfo, 0, count),
		Count:   int(count),
	}

	for i := int32(0); i < count; i++ {
		threadID, err := r.ReadObjectID()
		if err != nil {
			return nil, fmt.Errorf("parse thread %d: %w", i, err)
		}

		name := threadNames[threadID]
		if name == "" {
			name = fmt.Sprintf("Thread-%d", threadID)
		}

		result.Threads = append(result.Threads, &ThreadInfo{
			ThreadID: threadID,
			Name:     name,
			Status:   ThreadStatusRunning,
		})
	}

	return result, nil
}

// ParseThreadName parses a JDWP ThreadReference.Name reply.
//
// Reply format:
//
//	[string: thread name]
func ParseThreadName(data []byte) (string, error) {
	r := NewJDWPDataReader(data)
	return r.ReadString()
}

// ParseThreadStatus parses a JDWP ThreadReference.Status reply.
//
// Reply format:
//
//	[int: thread status]
//	[int: suspend status]
func ParseThreadStatus(data []byte) (int32, int32, error) {
	r := NewJDWPDataReader(data)
	status, err := r.ReadInt()
	if err != nil {
		return 0, 0, fmt.Errorf("parse thread status: %w", err)
	}
	suspendStatus, err := r.ReadInt()
	if err != nil {
		return 0, 0, fmt.Errorf("parse suspend status: %w", err)
	}
	return status, suspendStatus, nil
}

// ParseFrameCount parses a JDWP ThreadReference.FrameCount reply.
//
// Reply format:
//
//	[int: frame count]
func ParseFrameCount(data []byte) (int32, error) {
	r := NewJDWPDataReader(data)
	return r.ReadInt()
}

// ── JDWP Command Builders ────────────────────────────────────────

// BuildThreadFramesCommand builds a ThreadReference.Frames command.
// startFrame: index of first frame to retrieve
// length: number of frames to retrieve (-1 for all)
func BuildThreadFramesCommand(threadID int64, startFrame, length int32) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(threadID)
	w.WriteInt(startFrame)
	w.WriteInt(length)
	return w.Bytes()
}

// BuildThreadNameCommand builds a ThreadReference.Name command.
func BuildThreadNameCommand(threadID int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(threadID)
	return w.Bytes()
}

// BuildThreadStatusCommand builds a ThreadReference.Status command.
func BuildThreadStatusCommand(threadID int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(threadID)
	return w.Bytes()
}

// BuildThreadFrameCountCommand builds a ThreadReference.FrameCount command.
func BuildThreadFrameCountCommand(threadID int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(threadID)
	return w.Bytes()
}

// BuildAllThreadsCommand builds a VirtualMachine.AllThreads command.
func BuildAllThreadsCommand() []byte {
	return NewJDWPDataWriter().Bytes()
}

// BuildVersionCommand builds a VirtualMachine.Version command.
func BuildVersionCommand() []byte {
	return NewJDWPDataWriter().Bytes()
}

// BuildSourceFileCommand builds a ReferenceType.SourceFile command.
func BuildSourceFileCommand(classID int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteObjectID(classID)
	return w.Bytes()
}

// ── Watchpoint Support ──────────────────────────────────────────

// WatchpointKind defines the type of watchpoint.
type WatchpointKind string

const (
	WatchpointAccess       WatchpointKind = "access"
	WatchpointModification WatchpointKind = "modification"
)

// WatchpointRequest represents a field watchpoint event request.
type WatchpointRequest struct {
	EventKind WatchpointKind `json:"eventKind"`
	ClassName string         `json:"className"`
	FieldName string         `json:"fieldName"`
	ClassID   int64          `json:"classId"`
	FieldID   int64          `json:"fieldId"`
	RequestID int32          `json:"requestId"`
}

// BuildFieldAccessWatchpointCommand builds an EventRequest.Set for
// field access watchpoint.
//
// Command data:
//
//	byte: eventKind (20 = field access)
//	byte: suspendPolicy
//	int:  modifier count
//	[modifiers:
//	  byte: 1 (fieldOnly)
//	  long: classID
//	  long: fieldID]
func BuildFieldAccessWatchpointCommand(classID, fieldID int64, suspendPolicy byte) []byte {
	w := NewJDWPDataWriter()
	w.WriteByte(eventKindFieldAccess)
	w.WriteByte(suspendPolicy)
	w.WriteInt(1) // one modifier

	// FieldOnly modifier
	w.WriteByte(9) // ModKind.FieldOnly = 9
	w.WriteObjectID(classID)
	w.WriteObjectID(fieldID)

	return w.Bytes()
}

// BuildFieldModificationWatchpointCommand builds an EventRequest.Set
// for field modification watchpoint.
func BuildFieldModificationWatchpointCommand(classID, fieldID int64, suspendPolicy byte) []byte {
	w := NewJDWPDataWriter()
	w.WriteByte(eventKindFieldModification)
	w.WriteByte(suspendPolicy)
	w.WriteInt(1) // one modifier

	// FieldOnly modifier
	w.WriteByte(9) // ModKind.FieldOnly = 9
	w.WriteObjectID(classID)
	w.WriteObjectID(fieldID)

	return w.Bytes()
}

// BuildClearEventRequestCommand builds an EventRequest.Clear command.
func BuildClearEventRequestCommand(eventKind byte, requestID int32) []byte {
	w := NewJDWPDataWriter()
	w.WriteByte(eventKind)
	w.WriteInt(requestID)
	return w.Bytes()
}

// ParseEventRequestSetReply parses the reply to EventRequest.Set.
//
// Reply format:
//
//	[int: requestID]
func ParseEventRequestSetReply(data []byte) (int32, error) {
	r := NewJDWPDataReader(data)
	return r.ReadInt()
}

// ── Version Parsing ──────────────────────────────────────────────

// JDWPVersion holds JDWP version information.
type JDWPVersion struct {
	Description string `json:"description"`
	JDWPMajor   int32  `json:"jdwpMajor"`
	JDWPMinor   int32  `json:"jdwpMinor"`
	VMVersion   string `json:"vmVersion"`
	VMName      string `json:"vmName"`
}

// ParseVersion parses a JDWP VirtualMachine.Version reply.
//
// Reply format:
//
//	[string: description]
//	[int: jdwpMajor]
//	[int: jdwpMinor]
//	[string: vmVersion]
//	[string: vmName]
func ParseVersion(data []byte) (*JDWPVersion, error) {
	r := NewJDWPDataReader(data)

	desc, err := r.ReadString()
	if err != nil {
		return nil, fmt.Errorf("parse version description: %w", err)
	}

	major, err := r.ReadInt()
	if err != nil {
		return nil, fmt.Errorf("parse JDWP major: %w", err)
	}

	minor, err := r.ReadInt()
	if err != nil {
		return nil, fmt.Errorf("parse JDWP minor: %w", err)
	}

	vmVersion, err := r.ReadString()
	if err != nil {
		return nil, fmt.Errorf("parse VM version: %w", err)
	}

	vmName, err := r.ReadString()
	if err != nil {
		return nil, fmt.Errorf("parse VM name: %w", err)
	}

	return &JDWPVersion{
		Description: desc,
		JDWPMajor:   major,
		JDWPMinor:   minor,
		VMVersion:   vmVersion,
		VMName:      vmName,
	}, nil
}