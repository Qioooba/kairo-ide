package debug

import (
	"testing"
)

func TestHotSwapManager_New(t *testing.T) {
	hsm := NewHotSwapManager()
	if hsm == nil {
		t.Fatal("expected non-nil HotSwapManager")
	}
	if hsm.ActiveRedefinitionCount() != 0 {
		t.Errorf("expected 0 active, got %d", hsm.ActiveRedefinitionCount())
	}
}

func TestHotSwapManager_SetCapabilities(t *testing.T) {
	hsm := NewHotSwapManager()

	caps := &DebugCapabilities{
		CanRedefineClasses:                 true,
		CanUnrestrictedlyRedefineClasses:   true,
	}
	hsm.SetCapabilities(caps)

	if !hsm.CanRedefineClasses() {
		t.Error("expected CanRedefineClasses to be true")
	}
	if !hsm.CanRetransformClasses() {
		t.Error("expected CanRetransformClasses to be true")
	}
}

func TestHotSwapManager_SetCapabilities_Nil(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(nil)

	// Should not panic
	if hsm.CanRedefineClasses() {
		t.Error("expected CanRedefineClasses to be false with nil caps")
	}
}

func TestHotSwapManager_RedefineClass_Success(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})

	// Create minimal valid Java class file bytes (magic: 0xCAFEBABE)
	originalBytes := makeMinimalClassBytes()
	newBytes := makeMinimalClassBytes()
	newBytes[10] = 0x42 // Slightly modify the bytecode

	result := hsm.RedefineClass("com.example.Test", newBytes, originalBytes)
	if result.Status != HotSwapCompleted {
		t.Errorf("expected completed, got %s: %s", result.Status, result.ErrorMessage)
	}
	if result.ClassName != "com.example.Test" {
		t.Errorf("expected com.example.Test, got %s", result.ClassName)
	}

	if !hsm.HasBackup("com.example.Test") {
		t.Error("should have backup after redefinition")
	}
}

func TestHotSwapManager_RedefineClass_NotSupported(t *testing.T) {
	hsm := NewHotSwapManager()
	// Don't set capabilities

	originalBytes := makeMinimalClassBytes()
	newBytes := makeMinimalClassBytes()

	result := hsm.RedefineClass("com.example.Test", newBytes, originalBytes)
	if result.Status != HotSwapNotSupported {
		t.Errorf("expected not_supported, got %s", result.Status)
	}
}

func TestHotSwapManager_RedefineClass_InvalidBytes(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})

	result := hsm.RedefineClass("com.example.Test", []byte{0x00, 0x01}, []byte{})
	if result.Status != HotSwapFailed {
		t.Errorf("expected failed, got %s", result.Status)
	}
	if result.ErrorMessage == "" {
		t.Error("expected error message")
	}
}

func TestHotSwapManager_RedefineClass_SchemaIncompatible(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})

	originalBytes := makeMinimalClassBytes()
	// Create class bytes with different constant pool
	newBytes := makeMinimalClassBytes()
	newBytes[9] = 0x05 // Change constant pool count

	result := hsm.RedefineClass("com.example.Test", newBytes, originalBytes)
	if result.Status != HotSwapFailed {
		t.Errorf("expected failed, got %s", result.Status)
	}
}

func TestHotSwapManager_Rollback(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})

	originalBytes := makeMinimalClassBytes()
	newBytes := makeMinimalClassBytes()

	hsm.RedefineClass("com.example.Test", newBytes, originalBytes)

	result, err := hsm.Rollback("com.example.Test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Status != HotSwapRolledBack {
		t.Errorf("expected rolled_back, got %s", result.Status)
	}
	if !result.WasRolledBack {
		t.Error("expected WasRolledBack to be true")
	}
}

func TestHotSwapManager_Rollback_NoBackup(t *testing.T) {
	hsm := NewHotSwapManager()

	_, err := hsm.Rollback("com.example.NonExistent")
	if err == nil {
		t.Error("expected error when no backup exists")
	}
}

func TestHotSwapManager_RollbackAll(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})

	originalBytes := makeMinimalClassBytes()

	hsm.RedefineClass("com.example.A", makeMinimalClassBytes(), originalBytes)
	hsm.RedefineClass("com.example.B", makeMinimalClassBytes(), originalBytes)

	if hsm.ActiveRedefinitionCount() != 2 {
		t.Errorf("expected 2 active, got %d", hsm.ActiveRedefinitionCount())
	}

	results := hsm.RollbackAll()
	if len(results) != 2 {
		t.Errorf("expected 2 rollback results, got %d", len(results))
	}
	if hsm.ActiveRedefinitionCount() != 0 {
		t.Errorf("expected 0 active after rollback all, got %d", hsm.ActiveRedefinitionCount())
	}
}

func TestHotSwapManager_ReplaceMethodBody(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})

	result := hsm.ReplaceMethodBody("com.example.Test", "doWork", []byte{0x01, 0x02, 0x03})
	if result.Status != HotSwapCompleted {
		t.Errorf("expected completed, got %s: %s", result.Status, result.ErrorMessage)
	}
	if result.MethodsChanged != 1 {
		t.Errorf("expected 1 method changed, got %d", result.MethodsChanged)
	}
}

func TestHotSwapManager_ReplaceMethodBody_NotSupported(t *testing.T) {
	hsm := NewHotSwapManager()

	result := hsm.ReplaceMethodBody("com.example.Test", "doWork", []byte{0x01})
	if result.Status != HotSwapNotSupported {
		t.Errorf("expected not_supported, got %s", result.Status)
	}
}

func TestHotSwapManager_GetHistory(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})

	originalBytes := makeMinimalClassBytes()

	hsm.RedefineClass("com.example.A", makeMinimalClassBytes(), originalBytes)
	hsm.RedefineClass("com.example.B", makeMinimalClassBytes(), originalBytes)

	history := hsm.GetHistory()
	if len(history) != 2 {
		t.Errorf("expected 2 history entries, got %d", len(history))
	}
}

func TestHotSwapManager_GetLastResult(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})

	originalBytes := makeMinimalClassBytes()

	hsm.RedefineClass("com.example.A", makeMinimalClassBytes(), originalBytes)
	hsm.RedefineClass("com.example.B", makeMinimalClassBytes(), originalBytes)

	last := hsm.GetLastResult()
	if last == nil {
		t.Fatal("expected non-nil last result")
	}
	if last.ClassName != "com.example.B" {
		t.Errorf("expected com.example.B, got %s", last.ClassName)
	}
}

func TestHotSwapManager_GetLastResult_Empty(t *testing.T) {
	hsm := NewHotSwapManager()
	last := hsm.GetLastResult()
	if last != nil {
		t.Error("expected nil when no history")
	}
}

func TestHotSwapManager_GetBackup(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})

	originalBytes := makeMinimalClassBytes()
	hsm.RedefineClass("com.example.Test", makeMinimalClassBytes(), originalBytes)

	backup, ok := hsm.GetBackup("com.example.Test")
	if !ok {
		t.Fatal("expected backup to exist")
	}
	if len(backup) != len(originalBytes) {
		t.Errorf("expected %d bytes, got %d", len(originalBytes), len(backup))
	}

	_, ok = hsm.GetBackup("com.example.NonExistent")
	if ok {
		t.Error("should not find backup for nonexistent class")
	}
}

func TestHotSwapManager_GetMethodReplacements(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})

	hsm.ReplaceMethodBody("com.example.Test", "doWork", []byte{0x01})
	hsm.ReplaceMethodBody("com.example.Test", "doOther", []byte{0x02})

	replacements := hsm.GetMethodReplacements("com.example.Test")
	if len(replacements) != 2 {
		t.Errorf("expected 2 replacements, got %d", len(replacements))
	}

	replacements = hsm.GetMethodReplacements("com.example.NonExistent")
	if replacements != nil {
		t.Error("expected nil for nonexistent class")
	}
}

func TestHotSwapManager_ClearHistory(t *testing.T) {
	hsm := NewHotSwapManager()
	hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})

	originalBytes := makeMinimalClassBytes()
	hsm.RedefineClass("com.example.Test", makeMinimalClassBytes(), originalBytes)

	hsm.ClearHistory()
	if len(hsm.GetHistory()) != 0 {
		t.Error("expected empty history after clear")
	}
}

func TestHotSwapManager_ValidateClassBytes(t *testing.T) {
	hsm := NewHotSwapManager()

	// Valid class bytes
	err := hsm.validateClassBytes(makeMinimalClassBytes())
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	// Too short
	err = hsm.validateClassBytes([]byte{0xCA, 0xFE})
	if err == nil {
		t.Error("expected error for too-short bytes")
	}

	// Wrong magic number
	wrong := makeMinimalClassBytes()
	wrong[0] = 0xDE
	err = hsm.validateClassBytes(wrong)
	if err == nil {
		t.Error("expected error for wrong magic number")
	}
}

// ── JDWP Command Builder Tests ────────────────────────────────────

func TestBuildRedefineClassesCommand(t *testing.T) {
	classBytes := makeMinimalClassBytes()
	classes := []ClassRedefinition{
		{
			RefTypeTag:   1,
			RefTypeID:    0x100,
			ClassVersion: 0x320000, // 50.0 (Java 6)
			ClassBytes:   classBytes,
		},
	}

	data := BuildRedefineClassesCommand(classes)
	r := NewJDWPDataReader(data)

	count, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("expected 1 class, got %d", count)
	}

	refTypeID, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if refTypeID != 0x100 {
		t.Errorf("expected 0x100, got %d", refTypeID)
	}

	byteCount, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if int(byteCount) != len(classBytes) {
		t.Errorf("byte count = %d, want %d", byteCount, len(classBytes))
	}
}

func TestBuildRetransformClassesCommand(t *testing.T) {
	data := BuildRetransformClassesCommand([]int64{0x100, 0x200})
	r := NewJDWPDataReader(data)

	count, err := r.ReadInt()
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("expected 2 classes, got %d", count)
	}

	id1, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if id1 != 0x100 {
		t.Errorf("expected 0x100, got %d", id1)
	}

	id2, err := r.ReadObjectID()
	if err != nil {
		t.Fatal(err)
	}
	if id2 != 0x200 {
		t.Errorf("expected 0x200, got %d", id2)
	}
}

func TestNewClassRedefinition(t *testing.T) {
	classBytes := makeMinimalClassBytes()
	cr := NewClassRedefinition(0x100, classBytes)

	if cr.RefTypeTag != 1 {
		t.Errorf("expected RefTypeTag 1, got %d", cr.RefTypeTag)
	}
	if cr.RefTypeID != 0x100 {
		t.Errorf("expected RefTypeID 0x100, got %d", cr.RefTypeID)
	}
	if len(cr.ClassBytes) != len(classBytes) {
		t.Errorf("expected %d bytes, got %d", len(classBytes), len(cr.ClassBytes))
	}
}

// ── Helpers ────────────────────────────────────────────────────────

// makeMinimalClassBytes creates a minimal valid Java class file with
// the magic number 0xCAFEBABE and minimal structure.
func makeMinimalClassBytes() []byte {
	// Java class file structure:
	// u4 magic (0xCAFEBABE)
	// u2 minor_version
	// u2 major_version (50 = Java 6)
	// u2 constant_pool_count
	// u1 constant_pool[1] (CONSTANT_Class referencing #2)
	//   u2 name_index = 2
	// u1 constant_pool[2] (CONSTANT_Utf8 "java/lang/Object")
	//   u2 length = 16
	//   bytes = "java/lang/Object"
	// u2 access_flags (0x0021 = public + super)
	// u2 this_class = 1
	// u2 super_class = 1
	// u2 interfaces_count = 0
	// u2 fields_count = 0
	// u2 methods_count = 0
	// u2 attributes_count = 0

	utf8Bytes := []byte("java/lang/Object")
	data := []byte{
		0xCA, 0xFE, 0xBA, 0xBE, // magic
		0x00, 0x00, // minor_version
		0x00, 0x32, // major_version (50 = Java 6)
		0x00, 0x03, // constant_pool_count (2 entries + 1 for the count)
		0x07,       // CONSTANT_Class
		0x00, 0x02, // name_index = 2
		0x01,       // CONSTANT_Utf8
	}
	// Append length and bytes for the UTF8 entry
	length := byte(len(utf8Bytes))
	data = append(data, 0x00, length) // u2 length
	data = append(data, utf8Bytes...)

	// access_flags, this_class, super_class, interfaces_count, fields_count, methods_count, attributes_count
	data = append(data,
		0x00, 0x21, // access_flags (ACC_PUBLIC | ACC_SUPER)
		0x00, 0x01, // this_class = 1
		0x00, 0x01, // super_class = 1 (Object)
		0x00, 0x00, // interfaces_count = 0
		0x00, 0x00, // fields_count = 0
		0x00, 0x00, // methods_count = 0
		0x00, 0x00, // attributes_count = 0
	)

	return data
}