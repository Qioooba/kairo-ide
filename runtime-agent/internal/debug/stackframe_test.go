package debug

import (
	"testing"
)

// ── Stack Frame Parsing Tests ───────────────────────────────────

func buildFrameReplyData(frames []struct {
	frameID int64
	tag   byte
	classID int64
	methodID int64
	index int64
}) []byte {
	w := NewJDWPDataWriter()
	w.WriteInt(int32(len(frames)))
	for _, f := range frames {
		w.WriteLong(f.frameID)
		// Location
		w.WriteByte(f.tag)
		w.WriteLong(f.classID)
		w.WriteLong(f.methodID)
		w.WriteLong(f.index)
	}
	return w.Bytes()
}

func TestParseStackFrames_SingleFrame(t *testing.T) {
	data := buildFrameReplyData([]struct {
		frameID  int64
		tag      byte
		classID  int64
		methodID int64
		index    int64
	}{
		{100, 1, 200, 300, 0},
	})

	result, err := ParseStackFrames(data, 1)
	if err != nil {
		t.Fatalf("ParseStackFrames failed: %v", err)
	}

	if result.Count != 1 {
		t.Errorf("Count = %d, want 1", result.Count)
	}
	if result.ThreadID != 1 {
		t.Errorf("ThreadID = %d, want 1", result.ThreadID)
	}
	if len(result.Frames) != 1 {
		t.Fatalf("len(Frames) = %d, want 1", len(result.Frames))
	}
	if result.Frames[0].FrameID != 100 {
		t.Errorf("FrameID = %d, want 100", result.Frames[0].FrameID)
	}
	if result.Frames[0].Index != 0 {
		t.Errorf("Index = %d, want 0", result.Frames[0].Index)
	}
}

func TestParseStackFrames_MultipleFrames(t *testing.T) {
	data := buildFrameReplyData([]struct {
		frameID  int64
		tag      byte
		classID  int64
		methodID int64
		index    int64
	}{
		{100, 1, 200, 300, 0},
		{101, 1, 201, 301, 1},
		{102, 1, 202, 302, 2},
		{103, 1, 203, 303, 3},
	})

	result, err := ParseStackFrames(data, 5)
	if err != nil {
		t.Fatalf("ParseStackFrames failed: %v", err)
	}

	if result.Count != 4 {
		t.Errorf("Count = %d, want 4", result.Count)
	}
	if len(result.Frames) != 4 {
		t.Fatalf("len(Frames) = %d, want 4", len(result.Frames))
	}

	for i, frame := range result.Frames {
		if frame.Index != i {
			t.Errorf("Frames[%d].Index = %d, want %d", i, frame.Index, i)
		}
	}
}

func TestParseStackFrames_Empty(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(0) // zero frames
	data := w.Bytes()

	result, err := ParseStackFrames(data, 1)
	if err != nil {
		t.Fatalf("ParseStackFrames empty failed: %v", err)
	}
	if result.Count != 0 {
		t.Errorf("Count = %d, want 0", result.Count)
	}
	if len(result.Frames) != 0 {
		t.Errorf("len(Frames) = %d, want 0", len(result.Frames))
	}
}

func TestParseStackFrames_InvalidData(t *testing.T) {
	_, err := ParseStackFrames([]byte{0x00}, 1)
	if err == nil {
		t.Error("Expected error for truncated data")
	}
}

// ── Frame Location Tests ────────────────────────────────────────

func TestParseFrameLocations(t *testing.T) {
	frames := []*StackFrame{
		{FrameID: 100, Index: 0},
		{FrameID: 200, Index: 1},
	}

	classData := map[int64]*ClassLocationInfo{
		100: {
			ClassName:  "com.example.MyClass",
			MethodName: "doWork",
			SourceFile: "MyClass.java",
			LineNumber: 42,
		},
		200: {
			ClassName:  "com.example.Main",
			MethodName: "main",
			SourceFile: "Main.java",
			LineNumber: 10,
		},
	}

	err := ParseFrameLocations(frames, classData)
	if err != nil {
		t.Fatalf("ParseFrameLocations failed: %v", err)
	}

	if frames[0].ClassName != "com.example.MyClass" {
		t.Errorf("frames[0].ClassName = %q", frames[0].ClassName)
	}
	if frames[0].MethodName != "doWork" {
		t.Errorf("frames[0].MethodName = %q", frames[0].MethodName)
	}
	if frames[0].SourceFile != "MyClass.java" {
		t.Errorf("frames[0].SourceFile = %q", frames[0].SourceFile)
	}
	if frames[1].LineNumber != 10 {
		t.Errorf("frames[1].LineNumber = %d", frames[1].LineNumber)
	}
}

func TestParseFrameLocations_EmptyData(t *testing.T) {
	frames := []*StackFrame{
		{FrameID: 100, Index: 0},
	}

	err := ParseFrameLocations(frames, nil)
	if err != nil {
		t.Fatalf("ParseFrameLocations with nil should not error: %v", err)
	}
	// Frames should remain unchanged
	if frames[0].ClassName != "" {
		t.Errorf("ClassName should be empty, got %q", frames[0].ClassName)
	}
}

// ── Thread Parsing Tests ────────────────────────────────────────

func TestParseThreadList(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(3)
	w.WriteObjectID(100)
	w.WriteObjectID(200)
	w.WriteObjectID(300)
	data := w.Bytes()

	names := map[int64]string{
		100: "main",
		200: "GC",
		300: "Worker-1",
	}

	result, err := ParseThreadList(data, names)
	if err != nil {
		t.Fatalf("ParseThreadList failed: %v", err)
	}

	if result.Count != 3 {
		t.Errorf("Count = %d, want 3", result.Count)
	}
	if len(result.Threads) != 3 {
		t.Fatalf("len(Threads) = %d, want 3", len(result.Threads))
	}

	checks := []struct {
		id   int64
		name string
	}{
		{100, "main"},
		{200, "GC"},
		{300, "Worker-1"},
	}

	for i, c := range checks {
		if result.Threads[i].ThreadID != c.id {
			t.Errorf("Threads[%d].ThreadID = %d, want %d", i, result.Threads[i].ThreadID, c.id)
		}
		if result.Threads[i].Name != c.name {
			t.Errorf("Threads[%d].Name = %q, want %q", i, result.Threads[i].Name, c.name)
		}
	}
}

func TestParseThreadList_MissingNames(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(1)
	w.WriteObjectID(42)
	data := w.Bytes()

	result, err := ParseThreadList(data, nil)
	if err != nil {
		t.Fatalf("ParseThreadList failed: %v", err)
	}

	if result.Threads[0].Name != "Thread-42" {
		t.Errorf("Name = %q, want Thread-42", result.Threads[0].Name)
	}
}

func TestParseThreadName(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteString("Signal Dispatcher")
	data := w.Bytes()

	name, err := ParseThreadName(data)
	if err != nil {
		t.Fatalf("ParseThreadName failed: %v", err)
	}
	if name != "Signal Dispatcher" {
		t.Errorf("Name = %q, want Signal Dispatcher", name)
	}
}

func TestParseThreadStatus(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(ThreadStatusRunning)
	w.WriteInt(0)
	data := w.Bytes()

	status, suspend, err := ParseThreadStatus(data)
	if err != nil {
		t.Fatalf("ParseThreadStatus failed: %v", err)
	}
	if status != ThreadStatusRunning {
		t.Errorf("status = %d, want %d", status, ThreadStatusRunning)
	}
	if suspend != 0 {
		t.Errorf("suspend = %d, want 0", suspend)
	}
}

func TestParseFrameCount(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(15)
	data := w.Bytes()

	count, err := ParseFrameCount(data)
	if err != nil {
		t.Fatalf("ParseFrameCount failed: %v", err)
	}
	if count != 15 {
		t.Errorf("count = %d, want 15", count)
	}
}

// ── Thread Status Name Tests ────────────────────────────────────

func TestThreadStatusName(t *testing.T) {
	tests := []struct {
		status int32
		want   string
	}{
		{ThreadStatusZombie, "zombie"},
		{ThreadStatusRunning, "running"},
		{ThreadStatusSleeping, "sleeping"},
		{ThreadStatusMonitor, "monitor"},
		{ThreadStatusWait, "wait"},
		{99, "unknown(99)"},
	}

	for _, tt := range tests {
		got := ThreadStatusName(tt.status)
		if got != tt.want {
			t.Errorf("ThreadStatusName(%d) = %q, want %q", tt.status, got, tt.want)
		}
	}
}

// ── Source File Parsing Tests ───────────────────────────────────

func TestParseSourceFile(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteString("MyServlet.java")
	data := w.Bytes()

	name, err := ParseSourceFile(data)
	if err != nil {
		t.Fatalf("ParseSourceFile failed: %v", err)
	}
	if name != "MyServlet.java" {
		t.Errorf("SourceFile = %q, want MyServlet.java", name)
	}
}

// ── Version Parsing Tests ───────────────────────────────────────

func TestParseVersion(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteString("Java Debug Wire Protocol (Reference Implementation) version 1.6")
	w.WriteInt(1)  // jdwpMajor
	w.WriteInt(6)  // jdwpMinor
	w.WriteString("1.6.0_45")
	w.WriteString("Java HotSpot(TM) Client VM")
	data := w.Bytes()

	version, err := ParseVersion(data)
	if err != nil {
		t.Fatalf("ParseVersion failed: %v", err)
	}

	if version.JDWPMajor != 1 {
		t.Errorf("JDWPMajor = %d, want 1", version.JDWPMajor)
	}
	if version.JDWPMinor != 6 {
		t.Errorf("JDWPMinor = %d, want 6", version.JDWPMinor)
	}
	if version.VMVersion != "1.6.0_45" {
		t.Errorf("VMVersion = %q, want 1.6.0_45", version.VMVersion)
	}
	if version.VMName != "Java HotSpot(TM) Client VM" {
		t.Errorf("VMName = %q, want Java HotSpot(TM) Client VM", version.VMName)
	}
}

// ── Watchpoint Command Builder Tests ────────────────────────────

func TestBuildFieldAccessWatchpointCommand(t *testing.T) {
	data := BuildFieldAccessWatchpointCommand(0x100, 0x200, suspendAll)
	r := NewJDWPDataReader(data)

	eventKind, err := r.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if eventKind != eventKindFieldAccess {
		t.Errorf("eventKind = %d, want %d", eventKind, eventKindFieldAccess)
	}

	suspend, err := r.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if suspend != suspendAll {
		t.Errorf("suspendPolicy = %d, want %d", suspend, suspendAll)
	}

	modCount, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if modCount != 1 {
		t.Errorf("modCount = %d, want 1", modCount)
	}

	modKind, err := r.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if modKind != 9 {
		t.Errorf("modKind = %d, want 9", modKind)
	}

	classID, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if classID != 0x100 {
		t.Errorf("classID = %d, want 0x100", classID)
	}

	fieldID, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if fieldID != 0x200 {
		t.Errorf("fieldID = %d, want 0x200", fieldID)
	}
}

func TestBuildFieldModificationWatchpointCommand(t *testing.T) {
	data := BuildFieldModificationWatchpointCommand(0x300, 0x400, suspendEventThread)
	r := NewJDWPDataReader(data)

	eventKind, err := r.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if eventKind != eventKindFieldModification {
		t.Errorf("eventKind = %d, want %d", eventKind, eventKindFieldModification)
	}

	suspend, err := r.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if suspend != suspendEventThread {
		t.Errorf("suspendPolicy = %d, want %d", suspend, suspendEventThread)
	}
}

func TestBuildClearEventRequestCommand(t *testing.T) {
	data := BuildClearEventRequestCommand(eventKindBreakpoint, 5)
	r := NewJDWPDataReader(data)

	eventKind, err := r.ReadByte()
	if err != nil {
		t.Fatal(err)
	}
	if eventKind != eventKindBreakpoint {
		t.Errorf("eventKind = %d, want %d", eventKind, eventKindBreakpoint)
	}

	requestID, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if requestID != 5 {
		t.Errorf("requestID = %d, want 5", requestID)
	}
}

func TestParseEventRequestSetReply(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(42)
	data := w.Bytes()

	requestID, err := ParseEventRequestSetReply(data)
	if err != nil {
		t.Fatalf("ParseEventRequestSetReply failed: %v", err)
	}
	if requestID != 42 {
		t.Errorf("requestID = %d, want 42", requestID)
	}
}

// ── Command Builder Tests ───────────────────────────────────────

func TestBuildThreadFramesCommand(t *testing.T) {
	data := BuildThreadFramesCommand(100, 0, -1)
	r := NewJDWPDataReader(data)

	threadID, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if threadID != 100 {
		t.Errorf("threadID = %d, want 100", threadID)
	}

	start, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if start != 0 {
		t.Errorf("startFrame = %d, want 0", start)
	}

	length, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if length != -1 {
		t.Errorf("length = %d, want -1", length)
	}
}

func TestBuildThreadNameCommand(t *testing.T) {
	data := BuildThreadNameCommand(42)
	r := NewJDWPDataReader(data)

	id, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if id != 42 {
		t.Errorf("threadID = %d, want 42", id)
	}
}

func TestBuildAllThreadsCommand(t *testing.T) {
	data := BuildAllThreadsCommand()
	if len(data) != 0 {
		t.Errorf("AllThreads command should have no data, got %d bytes", len(data))
	}
}

func TestBuildVersionCommand(t *testing.T) {
	data := BuildVersionCommand()
	if len(data) != 0 {
		t.Errorf("Version command should have no data, got %d bytes", len(data))
	}
}

func TestBuildSourceFileCommand(t *testing.T) {
	data := BuildSourceFileCommand(0xABCD)
	r := NewJDWPDataReader(data)

	classID, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if classID != 0xABCD {
		t.Errorf("classID = %d, want 0xABCD", classID)
	}
}

// ── ClassLocationInfo Tests ─────────────────────────────────────

func TestClassLocationInfo(t *testing.T) {
	info := &ClassLocationInfo{
		ClassName:  "com.example.Test",
		MethodName: "testMethod",
		SourceFile: "Test.java",
		LineNumber: 25,
		ClassID:    100,
		MethodID:   200,
	}

	if info.ClassName != "com.example.Test" {
		t.Errorf("ClassName = %q", info.ClassName)
	}
	if info.MethodName != "testMethod" {
		t.Errorf("MethodName = %q", info.MethodName)
	}
	if info.SourceFile != "Test.java" {
		t.Errorf("SourceFile = %q", info.SourceFile)
	}
	if info.LineNumber != 25 {
		t.Errorf("LineNumber = %d", info.LineNumber)
	}
	if info.ClassID != 100 {
		t.Errorf("ClassID = %d", info.ClassID)
	}
	if info.MethodID != 200 {
		t.Errorf("MethodID = %d", info.MethodID)
	}
}

// ── BuildThreadStatusCommand Tests ───────────────────────────────

func TestBuildThreadStatusCommand(t *testing.T) {
	data := BuildThreadStatusCommand(42)
	r := NewJDWPDataReader(data)

	id, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if id != 42 {
		t.Errorf("threadID = %d, want 42", id)
	}
}

func TestBuildThreadFrameCountCommand(t *testing.T) {
	data := BuildThreadFrameCountCommand(99)
	r := NewJDWPDataReader(data)

	id, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if id != 99 {
		t.Errorf("threadID = %d, want 99", id)
	}
}

// ── ParseThreadList truncated test ───────────────────────────────

func TestParseThreadList_Truncated(t *testing.T) {
	_, err := ParseThreadList([]byte{0x00}, nil)
	if err == nil {
		t.Error("Expected error for truncated thread list")
	}
}

func TestParseThreadList_Empty(t *testing.T) {
	w := NewJDWPDataWriter()
	w.WriteInt(0)
	data := w.Bytes()

	result, err := ParseThreadList(data, nil)
	if err != nil {
		t.Fatalf("ParseThreadList empty failed: %v", err)
	}
	if result.Count != 0 {
		t.Errorf("Count = %d, want 0", result.Count)
	}
	if len(result.Threads) != 0 {
		t.Errorf("len(Threads) = %d, want 0", len(result.Threads))
	}
}

// ── ParseThreadStatus truncated test ─────────────────────────────

func TestParseThreadStatus_Truncated(t *testing.T) {
	_, _, err := ParseThreadStatus([]byte{0x00})
	if err == nil {
		t.Error("Expected error for truncated thread status")
	}
}

// ── ParseVersion edge cases ──────────────────────────────────────

func TestParseVersion_Truncated(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{"empty", []byte{}},
		{"truncated_desc", buildTruncatedVersion(0)},
		{"truncated_major", buildTruncatedVersion(5)},
		{"truncated_minor", buildTruncatedVersion(9)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseVersion(tt.data)
			if err == nil {
				t.Error("Expected error for truncated version data")
			}
		})
	}
}

func buildTruncatedVersion(n int) []byte {
	w := NewJDWPDataWriter()
	w.WriteString("test")
	w.WriteInt(1)
	w.WriteInt(6)
	w.WriteString("1.0")
	w.WriteString("vm")
	data := w.Bytes()
	if n < len(data) {
		return data[:n]
	}
	return data
}

// ── ParseFrameCount edge case ────────────────────────────────────

func TestParseFrameCount_Truncated(t *testing.T) {
	_, err := ParseFrameCount([]byte{0x00})
	if err == nil {
		t.Error("Expected error for truncated frame count")
	}
}

// ── ParseSourceFile edge case ────────────────────────────────────

func TestParseSourceFile_Truncated(t *testing.T) {
	_, err := ParseSourceFile([]byte{0x00})
	if err == nil {
		t.Error("Expected error for truncated source file")
	}
}

// ── ParseThreadName truncated ────────────────────────────────────

func TestParseThreadName_Truncated(t *testing.T) {
	_, err := ParseThreadName([]byte{0x00})
	if err == nil {
		t.Error("Expected error for truncated thread name")
	}
}

// ── ParseEventRequestSetReply truncated ──────────────────────────

func TestParseEventRequestSetReply_Truncated(t *testing.T) {
	_, err := ParseEventRequestSetReply([]byte{0x00})
	if err == nil {
		t.Error("Expected error for truncated event request reply")
	}
}

// ── StackFrame struct fields ─────────────────────────────────────

func TestStackFrame_Fields(t *testing.T) {
	frame := &StackFrame{
		FrameID:    100,
		ClassName:  "com.example.Test",
		MethodName: "testMethod",
		SourceFile: "Test.java",
		LineNumber: 42,
		IsNative:   true,
		IsOpaque:   false,
		IsObsolete: true,
		Index:      3,
	}

	if frame.FrameID != 100 {
		t.Errorf("FrameID = %d", frame.FrameID)
	}
	if !frame.IsNative {
		t.Error("IsNative should be true")
	}
	if frame.IsOpaque {
		t.Error("IsOpaque should be false")
	}
	if !frame.IsObsolete {
		t.Error("IsObsolete should be true")
	}
}

// ── ThreadInfo struct fields ─────────────────────────────────────

func TestThreadInfo_Fields(t *testing.T) {
	info := &ThreadInfo{
		ThreadID:    1,
		Name:        "main",
		Status:      ThreadStatusRunning,
		IsSuspended: true,
		FrameCount:  10,
	}

	if info.ThreadID != 1 {
		t.Errorf("ThreadID = %d", info.ThreadID)
	}
	if info.Name != "main" {
		t.Errorf("Name = %q", info.Name)
	}
	if !info.IsSuspended {
		t.Error("IsSuspended should be true")
	}
	if info.FrameCount != 10 {
		t.Errorf("FrameCount = %d", info.FrameCount)
	}
}

// ── WatchpointRequest struct ─────────────────────────────────────

func TestWatchpointRequest_Fields(t *testing.T) {
	req := &WatchpointRequest{
		EventKind: WatchpointAccess,
		ClassName: "com.example.Test",
		FieldName: "myField",
		ClassID:   100,
		FieldID:   200,
		RequestID: 5,
	}

	if req.EventKind != WatchpointAccess {
		t.Errorf("EventKind = %q", req.EventKind)
	}
	if req.ClassID != 100 {
		t.Errorf("ClassID = %d", req.ClassID)
	}
}