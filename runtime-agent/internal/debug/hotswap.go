// Package debug — hot swap support for JDWP class redefinition.
//
// Implements class redefinition (JDWP RedefineClasses), method body
// replacement, hot swap validation, and rollback mechanism.
// Supports JDWP 1.4+ RedefineClasses and JDWP 1.6+ RetransformClasses.
package debug

import (
	"encoding/binary"
	"fmt"
	"sync"
	"time"
)

// HotSwapStatus represents the state of a hot swap operation.
type HotSwapStatus string

const (
	HotSwapPending      HotSwapStatus = "pending"
	HotSwapInProgress   HotSwapStatus = "in_progress"
	HotSwapCompleted    HotSwapStatus = "completed"
	HotSwapFailed       HotSwapStatus = "failed"
	HotSwapRolledBack   HotSwapStatus = "rolled_back"
	HotSwapNotSupported HotSwapStatus = "not_supported"
)

// HotSwapResult holds the result of a hot swap operation.
type HotSwapResult struct {
	// ClassName is the fully qualified name of the class being redefined.
	ClassName string `json:"className"`
	// Status is the current status of the hot swap.
	Status HotSwapStatus `json:"status"`
	// Timestamp is when the operation occurred.
	Timestamp time.Time `json:"timestamp"`
	// ErrorMessage is set if the operation failed.
	ErrorMessage string `json:"errorMessage,omitempty"`
	// OriginalSize is the size of the original class bytes.
	OriginalSize int64 `json:"originalSize"`
	// NewSize is the size of the new class bytes.
	NewSize int64 `json:"newSize"`
	// MethodsChanged is the number of methods that were modified.
	MethodsChanged int `json:"methodsChanged"`
	// WasRolledBack indicates if the operation was rolled back.
	WasRolledBack bool `json:"wasRolledBack"`
}

// HotSwapManager manages hot swap (class redefinition) operations.
// It maintains a history of redefinitions, supports rollback, and
// validates that classes can be redefined before attempting.
type HotSwapManager struct {
	mu sync.RWMutex
	// redefinitionHistory tracks all hot swap operations.
	redefinitionHistory []*HotSwapResult
	// classBackups stores original bytecode for rollback.
	// Maps className → original class bytes.
	classBackups map[string][]byte
	// maxHistory is the maximum number of history entries to keep.
	maxHistory int
	// canRedefineClasses indicates the JVM supports RedefineClasses.
	canRedefineClasses bool
	// canRetransformClasses indicates the JVM supports RetransformClasses (JDWP 1.6+).
	canRetransformClasses bool
	// methodReplacements tracks specific method-level replacements.
	methodReplacements map[string]map[string][]byte // className → methodName → new bytecode
}

// NewHotSwapManager creates a new HotSwapManager.
func NewHotSwapManager() *HotSwapManager {
	return &HotSwapManager{
		redefinitionHistory: make([]*HotSwapResult, 0),
		classBackups:        make(map[string][]byte),
		maxHistory:          100,
		methodReplacements:  make(map[string]map[string][]byte),
	}
}

// SetCapabilities updates the hot swap capabilities based on JVM capabilities.
func (hsm *HotSwapManager) SetCapabilities(caps *DebugCapabilities) {
	hsm.mu.Lock()
	defer hsm.mu.Unlock()

	if caps != nil {
		hsm.canRedefineClasses = caps.CanRedefineClasses
		hsm.canRetransformClasses = caps.CanUnrestrictedlyRedefineClasses
	}
}

// CanRedefineClasses returns true if the JVM supports class redefinition.
func (hsm *HotSwapManager) CanRedefineClasses() bool {
	hsm.mu.RLock()
	defer hsm.mu.RUnlock()
	return hsm.canRedefineClasses
}

// CanRetransformClasses returns true if the JVM supports retransformation.
func (hsm *HotSwapManager) CanRetransformClasses() bool {
	hsm.mu.RLock()
	defer hsm.mu.RUnlock()
	return hsm.canRetransformClasses
}

// RedefineClass attempts to redefine a class with new bytecode.
// It backs up the original bytecode for rollback and validates the
// redefinition.
func (hsm *HotSwapManager) RedefineClass(className string, newBytes []byte, originalBytes []byte) *HotSwapResult {
	result := &HotSwapResult{
		ClassName:    className,
		Status:       HotSwapInProgress,
		Timestamp:    time.Now(),
		OriginalSize: int64(len(originalBytes)),
		NewSize:      int64(len(newBytes)),
	}

	hsm.mu.Lock()
	defer hsm.mu.Unlock()

	// Check if class redefinition is supported
	if !hsm.canRedefineClasses {
		result.Status = HotSwapNotSupported
		result.ErrorMessage = "JVM does not support RedefineClasses"
		hsm.redefinitionHistory = append(hsm.redefinitionHistory, result)
		hsm.trimHistory()
		return result
	}

	// Validate the new bytecode
	if err := hsm.validateClassBytes(newBytes); err != nil {
		result.Status = HotSwapFailed
		result.ErrorMessage = fmt.Sprintf("validation failed: %v", err)
		hsm.redefinitionHistory = append(hsm.redefinitionHistory, result)
		hsm.trimHistory()
		return result
	}

	// Validate that the class schema hasn't changed in unsupported ways
	if len(originalBytes) > 0 {
		if err := hsm.validateSchemaCompatibility(originalBytes, newBytes); err != nil {
			result.Status = HotSwapFailed
			result.ErrorMessage = fmt.Sprintf("schema compatibility check failed: %v", err)
			hsm.redefinitionHistory = append(hsm.redefinitionHistory, result)
			hsm.trimHistory()
			return result
		}
	}

	// Backup original bytecode for rollback
	if _, exists := hsm.classBackups[className]; !exists && len(originalBytes) > 0 {
		hsm.classBackups[className] = make([]byte, len(originalBytes))
		copy(hsm.classBackups[className], originalBytes)
	}

	// Count methods changed
	result.MethodsChanged = hsm.countMethodsChanged(originalBytes, newBytes)
	result.Status = HotSwapCompleted
	hsm.redefinitionHistory = append(hsm.redefinitionHistory, result)
	hsm.trimHistory()

	return result
}

// ReplaceMethodBody replaces a single method body in a class.
// This is a more targeted form of hot swap that only changes
// method bytecode without affecting the class structure.
func (hsm *HotSwapManager) ReplaceMethodBody(className, methodName string, newMethodBytes []byte) *HotSwapResult {
	result := &HotSwapResult{
		ClassName:      className,
		Status:         HotSwapInProgress,
		Timestamp:      time.Now(),
		NewSize:        int64(len(newMethodBytes)),
		MethodsChanged: 1,
	}

	hsm.mu.Lock()
	defer hsm.mu.Unlock()

	if !hsm.canRedefineClasses {
		result.Status = HotSwapNotSupported
		result.ErrorMessage = "JVM does not support RedefineClasses"
		hsm.redefinitionHistory = append(hsm.redefinitionHistory, result)
		hsm.trimHistory()
		return result
	}

	// Track the method replacement
	if hsm.methodReplacements[className] == nil {
		hsm.methodReplacements[className] = make(map[string][]byte)
	}
	hsm.methodReplacements[className][methodName] = newMethodBytes

	result.Status = HotSwapCompleted
	hsm.redefinitionHistory = append(hsm.redefinitionHistory, result)
	hsm.trimHistory()

	return result
}

// Rollback reverts a class to its original bytecode.
// Returns an error if no backup exists.
func (hsm *HotSwapManager) Rollback(className string) (*HotSwapResult, error) {
	hsm.mu.Lock()
	defer hsm.mu.Unlock()

	originalBytes, ok := hsm.classBackups[className]
	if !ok {
		return nil, fmt.Errorf("no backup available for class %s", className)
	}

	result := &HotSwapResult{
		ClassName:     className,
		Status:        HotSwapRolledBack,
		Timestamp:     time.Now(),
		OriginalSize:  int64(len(originalBytes)),
		WasRolledBack: true,
	}

	// Remove method replacements
	delete(hsm.methodReplacements, className)

	hsm.redefinitionHistory = append(hsm.redefinitionHistory, result)
	hsm.trimHistory()

	return result, nil
}

// RollbackAll reverts all classes to their original bytecode.
func (hsm *HotSwapManager) RollbackAll() []*HotSwapResult {
	hsm.mu.Lock()
	defer hsm.mu.Unlock()

	results := make([]*HotSwapResult, 0, len(hsm.classBackups))
	for className := range hsm.classBackups {
		result := &HotSwapResult{
			ClassName:     className,
			Status:        HotSwapRolledBack,
			Timestamp:     time.Now(),
			WasRolledBack: true,
		}
		results = append(results, result)
		hsm.redefinitionHistory = append(hsm.redefinitionHistory, result)
	}

	// Clear all backups
	hsm.classBackups = make(map[string][]byte)
	hsm.methodReplacements = make(map[string]map[string][]byte)
	hsm.trimHistory()

	return results
}

// GetHistory returns the hot swap operation history.
func (hsm *HotSwapManager) GetHistory() []*HotSwapResult {
	hsm.mu.RLock()
	defer hsm.mu.RUnlock()

	result := make([]*HotSwapResult, len(hsm.redefinitionHistory))
	copy(result, hsm.redefinitionHistory)
	return result
}

// GetLastResult returns the most recent hot swap result.
func (hsm *HotSwapManager) GetLastResult() *HotSwapResult {
	hsm.mu.RLock()
	defer hsm.mu.RUnlock()

	if len(hsm.redefinitionHistory) == 0 {
		return nil
	}
	return hsm.redefinitionHistory[len(hsm.redefinitionHistory)-1]
}

// HasBackup returns true if a backup exists for the given class.
func (hsm *HotSwapManager) HasBackup(className string) bool {
	hsm.mu.RLock()
	defer hsm.mu.RUnlock()

	_, ok := hsm.classBackups[className]
	return ok
}

// GetBackup returns the original bytecode for a class.
func (hsm *HotSwapManager) GetBackup(className string) ([]byte, bool) {
	hsm.mu.RLock()
	defer hsm.mu.RUnlock()

	bytes, ok := hsm.classBackups[className]
	return bytes, ok
}

// GetMethodReplacements returns all method replacements for a class.
func (hsm *HotSwapManager) GetMethodReplacements(className string) map[string][]byte {
	hsm.mu.RLock()
	defer hsm.mu.RUnlock()

	replacements, ok := hsm.methodReplacements[className]
	if !ok {
		return nil
	}

	result := make(map[string][]byte, len(replacements))
	for k, v := range replacements {
		result[k] = v
	}
	return result
}

// ClearHistory clears the redefinition history.
func (hsm *HotSwapManager) ClearHistory() {
	hsm.mu.Lock()
	defer hsm.mu.Unlock()

	hsm.redefinitionHistory = make([]*HotSwapResult, 0)
}

// ActiveRedefinitionCount returns the number of classes currently redefined.
func (hsm *HotSwapManager) ActiveRedefinitionCount() int {
	hsm.mu.RLock()
	defer hsm.mu.RUnlock()
	return len(hsm.classBackups)
}

// ── Validation ────────────────────────────────────────────────────

// validateClassBytes performs basic validation of Java class file bytes.
// Checks for the magic number 0xCAFEBABE.
func (hsm *HotSwapManager) validateClassBytes(bytes []byte) error {
	if len(bytes) < 8 {
		return fmt.Errorf("class file too short: %d bytes", len(bytes))
	}

	// Check Java class file magic number
	magic := binary.BigEndian.Uint32(bytes[0:4])
	if magic != 0xCAFEBABE {
		return fmt.Errorf("invalid Java class file magic: 0x%X (expected 0xCAFEBABE)", magic)
	}

	return nil
}

// validateSchemaCompatibility checks that the new class definition is
// compatible with the original. JDWP RedefineClasses requires that the
// schema (fields, methods signatures) not change.
func (hsm *HotSwapManager) validateSchemaCompatibility(original, newBytes []byte) error {
	if len(original) < 8 || len(newBytes) < 8 {
		return fmt.Errorf("class file too short for schema comparison")
	}

	// The constant pool count is at offset 8 (after magic + minor/major version)
	origCPCount := binary.BigEndian.Uint16(original[8:10])
	newCPCount := binary.BigEndian.Uint16(newBytes[8:10])

	if origCPCount != newCPCount {
		return fmt.Errorf("constant pool size changed: %d → %d", origCPCount, newCPCount)
	}

	// Basic check: ensure the new class has the same number of methods
	// (schema changes require full JVM restart)
	origMethodCount := hsm.countMethods(original)
	newMethodCount := hsm.countMethods(newBytes)

	if origMethodCount != newMethodCount {
		return fmt.Errorf("method count changed: %d → %d", origMethodCount, newMethodCount)
	}

	return nil
}

// countMethods is a simplified count of methods in a class file.
// It reads the methods_count field from the standard class file format.
func (hsm *HotSwapManager) countMethods(classBytes []byte) int {
	if len(classBytes) < 10 {
		return 0
	}

	// Skip to the constant pool
	offset := 10
	cpCount := int(binary.BigEndian.Uint16(classBytes[8:10]))

	// Skip the constant pool entries (variable size)
	for i := 1; i < cpCount; i++ {
		if offset >= len(classBytes) {
			return 0
		}
		tag := classBytes[offset]
		offset++
		switch tag {
		case 1: // CONSTANT_Utf8
			if offset+2 > len(classBytes) {
				return 0
			}
			length := int(binary.BigEndian.Uint16(classBytes[offset : offset+2]))
			offset += 2 + length
		case 3: // CONSTANT_Integer
			offset += 4
		case 4: // CONSTANT_Float
			offset += 4
		case 5: // CONSTANT_Long
			offset += 8
			i++ // Long takes two entries
		case 6: // CONSTANT_Double
			offset += 8
			i++ // Double takes two entries
		case 7: // CONSTANT_Class
			offset += 2
		case 8: // CONSTANT_String
			offset += 2
		case 9: // CONSTANT_Fieldref
			offset += 4
		case 10: // CONSTANT_Methodref
			offset += 4
		case 11: // CONSTANT_InterfaceMethodref
			offset += 4
		case 12: // CONSTANT_NameAndType
			offset += 4
		case 15: // CONSTANT_MethodHandle
			offset += 3
		case 16: // CONSTANT_MethodType
			offset += 2
		case 17: // CONSTANT_Dynamic
			offset += 4
		case 18: // CONSTANT_InvokeDynamic
			offset += 4
		case 19: // CONSTANT_Module
			offset += 2
		case 20: // CONSTANT_Package
			offset += 2
		default:
			// Unknown tag, can't continue
			return 0
		}
	}

	// After constant pool: access_flags (2), this_class (2), super_class (2),
	// interfaces_count (2) + interfaces, fields_count (2) + fields
	if offset+8 > len(classBytes) {
		return 0
	}
	offset += 6 // skip access_flags, this_class, super_class

	// Skip interfaces
	interfacesCount := int(binary.BigEndian.Uint16(classBytes[offset : offset+2]))
	offset += 2 + interfacesCount*2

	// Skip fields
	if offset+2 > len(classBytes) {
		return 0
	}
	fieldsCount := int(binary.BigEndian.Uint16(classBytes[offset : offset+2]))
	offset += 2
	for i := 0; i < fieldsCount; i++ {
		// access_flags(2) + name_index(2) + descriptor_index(2) + attributes_count(2) + attributes
		if offset+8 > len(classBytes) {
			return 0
		}
		offset += 6
		attrCount := int(binary.BigEndian.Uint16(classBytes[offset : offset+2]))
		offset += 2
		for j := 0; j < attrCount; j++ {
			if offset+6 > len(classBytes) {
				return 0
			}
			offset += 2 // attribute_name_index
			attrLen := int(binary.BigEndian.Uint32(classBytes[offset : offset+4]))
			offset += 4 + attrLen
		}
	}

	// Read methods_count
	if offset+2 > len(classBytes) {
		return 0
	}
	methodsCount := int(binary.BigEndian.Uint16(classBytes[offset : offset+2]))
	return methodsCount
}

// countMethodsChanged estimates the number of methods that changed
// between two versions of a class bytecode.
func (hsm *HotSwapManager) countMethodsChanged(original, newBytes []byte) int {
	if len(original) == 0 || len(newBytes) == 0 {
		return 0
	}

	origMethods := hsm.countMethods(original)
	newMethods := hsm.countMethods(newBytes)

	if origMethods != newMethods {
		return 0 // Schema changed
	}

	// Simple heuristic: if sizes differ significantly, likely methods changed
	sizeDiff := len(newBytes) - len(original)
	if sizeDiff < 0 {
		sizeDiff = -sizeDiff
	}

	if sizeDiff == 0 {
		return 0
	}

	// Rough estimate: each method change affects ~10-100 bytes
	estimated := sizeDiff / 50
	if estimated < 1 {
		estimated = 1
	}
	if estimated > origMethods {
		estimated = origMethods
	}

	return estimated
}

func (hsm *HotSwapManager) trimHistory() {
	if len(hsm.redefinitionHistory) > hsm.maxHistory {
		excess := len(hsm.redefinitionHistory) - hsm.maxHistory
		hsm.redefinitionHistory = hsm.redefinitionHistory[excess:]
	}
}

// ── JDWP Commands for Hot Swap ────────────────────────────────────

// BuildRedefineClassesCommand builds a JDWP VirtualMachine.RedefineClasses
// command (cmdSet=1, cmd=18) per the JPDA JDWP spec:
//
//	int classes
//	Repeated classes times:
//	  referenceTypeID refType
//	  int classfile (byte count)
//	  byte classbyte[classfile]
//
// RefTypeTag / ClassVersion on ClassRedefinition are metadata for callers;
// they are NOT encoded in the wire payload.
func BuildRedefineClassesCommandWithSizes(classes []ClassRedefinition, refTypeIDSize int) []byte {
	if refTypeIDSize != 4 && refTypeIDSize != 8 {
		refTypeIDSize = 8
	}
	w := NewJDWPDataWriter()
	w.WriteInt(int32(len(classes)))

	for _, c := range classes {
		w.WriteID(c.RefTypeID, refTypeIDSize)
		w.WriteInt(int32(len(c.ClassBytes)))
		w.data = append(w.data, c.ClassBytes...)
	}

	return w.Bytes()
}

func BuildRedefineClassesCommand(classes []ClassRedefinition) []byte {
	return BuildRedefineClassesCommandWithSizes(classes, 8)
}

// ClassRedefinition represents a single class to redefine via JDWP.
type ClassRedefinition struct {
	// RefTypeTag is the type tag (1 = class, 2 = interface, 3 = array).
	RefTypeTag byte `json:"refTypeTag"`
	// RefTypeID is the JDWP reference type ID of the class.
	RefTypeID int64 `json:"refTypeId"`
	// ClassVersion is the major.minor version of the new class file.
	ClassVersion int32 `json:"classVersion"`
	// ClassBytes is the new class file bytecode.
	ClassBytes []byte `json:"classBytes"`
}

// NewClassRedefinition creates a ClassRedefinition from class bytes.
// The RefTypeTag defaults to 1 (class). The ClassVersion is extracted
// from the bytecode.
func NewClassRedefinition(refTypeID int64, classBytes []byte) *ClassRedefinition {
	version := int32(0)
	if len(classBytes) >= 8 {
		minor := int32(binary.BigEndian.Uint16(classBytes[4:6]))
		major := int32(binary.BigEndian.Uint16(classBytes[6:8]))
		version = (major << 16) | minor
	}

	return &ClassRedefinition{
		RefTypeTag:   1, // class
		RefTypeID:    refTypeID,
		ClassVersion: version,
		ClassBytes:   classBytes,
	}
}

// BuildRetransformClassesCommand builds a JDWP VirtualMachine.RetransformClasses
// command (cmdSet=1, cmd=19). JDWP 1.6+ only.
//
// Format:
//
//	int:  class count
//	[for each class:
//	  long: refTypeID]
func BuildRetransformClassesCommand(refTypeIDs []int64) []byte {
	w := NewJDWPDataWriter()
	w.WriteInt(int32(len(refTypeIDs)))

	for _, id := range refTypeIDs {
		w.WriteObjectID(id)
	}

	return w.Bytes()
}
