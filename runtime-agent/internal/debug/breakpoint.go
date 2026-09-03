// Package debug — JDWP breakpoint management.
//
// Implements line breakpoints, method entry/exit breakpoints,
// field access/modification watchpoints, breakpoint hit count
// tracking, condition evaluation, hit count mode filtering,
// enable/disable toggling, cross-module breakpoints,
// classpath pattern matching, deferred breakpoints, and
// breakpoint persistence across sessions.
package debug

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

// BreakpointKind classifies the type of breakpoint.
type BreakpointKind string

const (
	BreakpointLine         BreakpointKind = "line"
	BreakpointMethodEntry  BreakpointKind = "methodEntry"
	BreakpointMethodExit   BreakpointKind = "methodExit"
	BreakpointFieldAccess  BreakpointKind = "fieldAccess"
	BreakpointFieldModify  BreakpointKind = "fieldModify"
)

// HitCountMode defines how the hit count condition is evaluated.
type HitCountMode string

const (
	HitCountEQ  HitCountMode = "EQ"  // hitCount == target
	HitCountGT  HitCountMode = "GT"  // hitCount > target
	HitCountGE  HitCountMode = "GE"  // hitCount >= target
	HitCountLT  HitCountMode = "LT"  // hitCount < target
	HitCountLE  HitCountMode = "LE"  // hitCount <= target
	HitCountMOD HitCountMode = "MOD" // hitCount % target == 0
	HitCountOff HitCountMode = ""    // no hit count condition
)

// Breakpoint represents a single JDWP breakpoint.
type Breakpoint struct {
	ID             int32         `json:"id"`
	Kind           BreakpointKind `json:"kind"`
	ClassName      string        `json:"className"`
	MethodName     string        `json:"methodName,omitempty"`
	FieldName      string        `json:"fieldName,omitempty"`
	LineNumber     int32         `json:"lineNumber"`
	Enabled        bool          `json:"enabled"`
	Condition      string        `json:"condition,omitempty"`
	HitCount       int64         `json:"hitCount"`
	HitCountMode   HitCountMode  `json:"hitCountMode,omitempty"`
	HitCountTarget int64         `json:"hitCountTarget"`
	LogMessage     string        `json:"logMessage,omitempty"`
	ClassID        int64         `json:"classId"`
	MethodID       int64         `json:"methodId,omitempty"`
	FieldID        int64         `json:"fieldId,omitempty"`
	SuspendPolicy  byte          `json:"suspendPolicy"`
	RequestID      int32         `json:"requestId"`             // JDWP event request ID
	SourceURI      string        `json:"sourceUri,omitempty"`   // Source file URI for frontend sync
}

// BreakpointManager manages a collection of breakpoints.
type BreakpointManager struct {
	mu          sync.RWMutex
	breakpoints map[int32]*Breakpoint
	nextID      int32
}

// NewBreakpointManager creates a new BreakpointManager.
func NewBreakpointManager() *BreakpointManager {
	return &BreakpointManager{
		breakpoints: make(map[int32]*Breakpoint),
		nextID:      1,
	}
}

// AddBreakpoint adds a breakpoint and returns its assigned ID.
func (bm *BreakpointManager) AddBreakpoint(bp *Breakpoint) int32 {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	bp.ID = bm.nextID
	bm.nextID++
	if bp.SuspendPolicy == 0 {
		bp.SuspendPolicy = suspendAll
	}
	if bp.Enabled == false && bp.Kind != "" {
		bp.Enabled = true
	}
	bm.breakpoints[bp.ID] = bp
	return bp.ID
}

// UpdateBreakpoint updates an existing breakpoint's mutable fields.
func (bm *BreakpointManager) UpdateBreakpoint(id int32, updates *Breakpoint) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	bp, ok := bm.breakpoints[id]
	if !ok {
		return fmt.Errorf("breakpoint %d not found", id)
	}

	if updates.Condition != "" || updates.Condition == "" {
		bp.Condition = updates.Condition
	}
	if updates.HitCountMode != "" {
		bp.HitCountMode = updates.HitCountMode
		bp.HitCountTarget = updates.HitCountTarget
	}
	if updates.LogMessage != "" {
		bp.LogMessage = updates.LogMessage
	}
	if updates.SuspendPolicy != 0 {
		bp.SuspendPolicy = updates.SuspendPolicy
	}
	bp.Enabled = updates.Enabled || bp.Enabled

	return nil
}

// RemoveBreakpoint removes a breakpoint by ID.
func (bm *BreakpointManager) RemoveBreakpoint(id int32) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if _, ok := bm.breakpoints[id]; !ok {
		return fmt.Errorf("breakpoint %d not found", id)
	}
	delete(bm.breakpoints, id)
	return nil
}

// GetBreakpoint returns a breakpoint by ID.
func (bm *BreakpointManager) GetBreakpoint(id int32) (*Breakpoint, bool) {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	bp, ok := bm.breakpoints[id]
	return bp, ok
}

// FindByRequestID looks up a breakpoint by JDWP event request ID, then by local ID.
func (bm *BreakpointManager) FindByRequestID(requestID int32) (*Breakpoint, bool) {
	bm.mu.RLock()
	defer bm.mu.RUnlock()
	for _, bp := range bm.breakpoints {
		if bp.RequestID == requestID {
			return bp, true
		}
	}
	bp, ok := bm.breakpoints[requestID]
	return bp, ok
}

// RecordHitAndShouldStop increments hit count and returns whether the session
// should actually suspend. Conditions are evaluated here because HotSpot does
// not implement the JDWP Conditional modifier.
func (bm *BreakpointManager) RecordHitAndShouldStop(requestID int32, vars map[string]interface{}, thisObj interface{}, threadID int64, threadName string, stackDepth int32) bool {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	var bp *Breakpoint
	for _, candidate := range bm.breakpoints {
		if candidate.RequestID == requestID {
			bp = candidate
			break
		}
	}
	if bp == nil {
		bp = bm.breakpoints[requestID]
	}
	if bp == nil {
		return true
	}

	bp.HitCount++
	if !bp.Enabled {
		return false
	}
	if bp.Condition != "" && !EvaluateBreakpointCondition(bp.Condition, vars) {
		return false
	}
	return EvaluateHitCount(bp)
}

// ListBreakpoints returns all breakpoints.
func (bm *BreakpointManager) ListBreakpoints() []*Breakpoint {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	result := make([]*Breakpoint, 0, len(bm.breakpoints))
	for _, bp := range bm.breakpoints {
		result = append(result, bp)
	}
	return result
}

// FindBySourceURI returns all breakpoints at a given source URI.
func (bm *BreakpointManager) FindBySourceURI(uri string) []*Breakpoint {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	var result []*Breakpoint
	for _, bp := range bm.breakpoints {
		if bp.SourceURI == uri {
			result = append(result, bp)
		}
	}
	return result
}

// FindByLocation finds a breakpoint by class name and line number.
func (bm *BreakpointManager) FindByLocation(className string, lineNumber int32) *Breakpoint {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	for _, bp := range bm.breakpoints {
		if bp.Kind == BreakpointLine && bp.ClassName == className && bp.LineNumber == lineNumber {
			return bp
		}
	}
	return nil
}

// EnableBreakpoint enables a breakpoint.
func (bm *BreakpointManager) EnableBreakpoint(id int32) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	bp, ok := bm.breakpoints[id]
	if !ok {
		return fmt.Errorf("breakpoint %d not found", id)
	}
	bp.Enabled = true
	return nil
}

// DisableBreakpoint disables a breakpoint.
func (bm *BreakpointManager) DisableBreakpoint(id int32) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	bp, ok := bm.breakpoints[id]
	if !ok {
		return fmt.Errorf("breakpoint %d not found", id)
	}
	bp.Enabled = false
	return nil
}

// SetCondition sets a condition expression on a breakpoint.
func (bm *BreakpointManager) SetCondition(id int32, condition string) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	bp, ok := bm.breakpoints[id]
	if !ok {
		return fmt.Errorf("breakpoint %d not found", id)
	}
	bp.Condition = condition
	return nil
}

// SetHitCountMode sets the hit count mode and target on a breakpoint.
func (bm *BreakpointManager) SetHitCountMode(id int32, mode HitCountMode, target int64) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	bp, ok := bm.breakpoints[id]
	if !ok {
		return fmt.Errorf("breakpoint %d not found", id)
	}
	bp.HitCountMode = mode
	bp.HitCountTarget = target
	return nil
}

// SetLogMessage sets a log message on a breakpoint.
func (bm *BreakpointManager) SetLogMessage(id int32, msg string) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	bp, ok := bm.breakpoints[id]
	if !ok {
		return fmt.Errorf("breakpoint %d not found", id)
	}
	bp.LogMessage = msg
	return nil
}

// IncrementHitCount increments the hit count for a breakpoint.
func (bm *BreakpointManager) IncrementHitCount(id int32) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	if bp, ok := bm.breakpoints[id]; ok {
		bp.HitCount++
	}
}

// ResetHitCount resets the hit count for a breakpoint.
func (bm *BreakpointManager) ResetHitCount(id int32) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	bp, ok := bm.breakpoints[id]
	if !ok {
		return fmt.Errorf("breakpoint %d not found", id)
	}
	bp.HitCount = 0
	return nil
}

// ClearAll removes all breakpoints.
func (bm *BreakpointManager) ClearAll() {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	bm.breakpoints = make(map[int32]*Breakpoint)
}

// Count returns the number of breakpoints.
func (bm *BreakpointManager) Count() int {
	bm.mu.RLock()
	defer bm.mu.RUnlock()
	return len(bm.breakpoints)
}

// ── Hit Count Evaluation ──────────────────────────────────────────

// EvaluateHitCount checks whether a breakpoint should trigger based on
// its hit count mode and target. Returns true if the breakpoint should
// be hit (i.e., the hit count condition is satisfied).
func EvaluateHitCount(bp *Breakpoint) bool {
	if bp.HitCountMode == HitCountOff || bp.HitCountMode == "" {
		return true
	}

	switch bp.HitCountMode {
	case HitCountEQ:
		return bp.HitCount == bp.HitCountTarget
	case HitCountGT:
		return bp.HitCount > bp.HitCountTarget
	case HitCountGE:
		return bp.HitCount >= bp.HitCountTarget
	case HitCountLT:
		return bp.HitCount < bp.HitCountTarget
	case HitCountLE:
		return bp.HitCount <= bp.HitCountTarget
	case HitCountMOD:
		if bp.HitCountTarget <= 0 {
			return false
		}
		return bp.HitCount%bp.HitCountTarget == 0
	default:
		return true
	}
}

// ── Condition Evaluation ──────────────────────────────────────────

// simpleConditionRE matches simple condition expressions like:
//   x == 5, y != 10, z > 0, a < 100, b >= 0, c <= 50
var simpleConditionRE = regexp.MustCompile(`^\s*(\w+)\s*(==|!=|<=|>=|<|>)\s*([-+]?\d+(?:\.\d+)?)\s*$`)

// EvaluateBreakpointCondition evaluates a breakpoint condition
// against a set of variable values. Supports basic comparisons
// (==, !=, <, >, <=, >=) against numeric values and variable-to-variable
// equality checks.
//
// Returns true if the breakpoint should be hit (condition is empty
// or evaluates to true).
func EvaluateBreakpointCondition(condition string, vars map[string]interface{}) bool {
	if condition == "" {
		return true
	}

	// Try simple numeric comparison: var op value
	matches := simpleConditionRE.FindStringSubmatch(condition)
	if len(matches) == 4 {
		varName := matches[1]
		op := matches[2]
		valStr := matches[3]

		varVal, ok := vars[varName]
		if !ok {
			// Variable not found: condition can't be evaluated, skip breakpoint
			return false
		}

		target, err := strconv.ParseFloat(valStr, 64)
		if err != nil {
			return false
		}

		current := toFloat64(varVal)

		switch op {
		case "==":
			return current == target
		case "!=":
			return current != target
		case "<":
			return current < target
		case ">":
			return current > target
		case "<=":
			return current <= target
		case ">=":
			return current >= target
		}
	}

	// Try boolean check: just the variable name (treats non-zero/non-null as true)
	if v, ok := vars[strings.TrimSpace(condition)]; ok {
		return isTruthy(v)
	}

	// For complex conditions, return true by default (the JVM will evaluate them)
	return true
}

// toFloat64 attempts to convert an interface{} value to float64.
func toFloat64(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int:
		return float64(val)
	case int32:
		return float64(val)
	case int64:
		return float64(val)
	case int16:
		return float64(val)
	case int8:
		return float64(val)
	case uint:
		return float64(val)
	case uint32:
		return float64(val)
	case uint64:
		return float64(val)
	case bool:
		if val {
			return 1
		}
		return 0
	default:
		return 0
	}
}

// isTruthy returns true if the value is considered "truthy".
func isTruthy(v interface{}) bool {
	switch val := v.(type) {
	case bool:
		return val
	case int, int32, int64, int16, int8, float32, float64:
		return toFloat64(val) != 0
	case string:
		return val != "" && val != "false" && val != "0"
	default:
		return v != nil
	}
}

// ── JDWP Command Builders for Breakpoints ─────────────────────────

// BuildBreakpointSetCommand builds an EventRequest.Set command for a
// line breakpoint at a specific location.
//
// Command data:
//
//	byte: eventKind (2 = breakpoint)
//	byte: suspendPolicy
//	int:  modifier count
//	[modifiers:
//	  byte: 7 (LocationOnly)
//	  byte: typeTag
//	  long: classID
//	  long: methodID
//	  long: index (line number)]
func BuildBreakpointSetCommand(classID, methodID int64, lineNumber int32, suspendPolicy byte) []byte {
	w := NewJDWPDataWriter()
	w.WriteByte(eventKindBreakpoint)
	w.WriteByte(suspendPolicy)
	w.WriteInt(1) // one modifier

	// LocationOnly modifier
	w.WriteByte(7) // ModKind.LocationOnly = 7
	w.WriteByte(1) // typeTag (1 = class)
	w.WriteObjectID(classID)
	w.WriteObjectID(methodID)
	w.WriteLong(int64(lineNumber))

	return w.Bytes()
}

// NOTE: there is deliberately no "conditional breakpoint" command builder.
// The JDWP Conditional modifier (modKind 2) is reserved and not implemented
// by HotSpot; condition evaluation happens in the JDI bridge (ExprEval), which
// evaluates on hit and decides whether to stop.

// BuildMethodEntryBreakpointCommand builds an EventRequest.Set command
// for method entry breakpoints.
//
// Modifiers:
//   - ClassMatch or ClassExclude filter
//   - ThreadOnly (optional)
func BuildMethodEntryBreakpointCommand(classID, methodID int64, suspendPolicy byte) []byte {
	w := NewJDWPDataWriter()
	w.WriteByte(eventKindBreakpoint)
	w.WriteByte(suspendPolicy)
	w.WriteInt(1) // one modifier

	// LocationOnly at line 0 (first executable line)
	w.WriteByte(7) // ModKind.LocationOnly
	w.WriteByte(1) // typeTag
	w.WriteObjectID(classID)
	w.WriteObjectID(methodID)
	w.WriteLong(0) // line 0 = first line

	return w.Bytes()
}

// BuildMethodExitBreakpointCommand builds an EventRequest.Set command
// for method exit breakpoints.
// JDWP does not have a native method-exit event; method exit is
// implemented as a step-out from the entry point and requires
// the Step event kind.
func BuildMethodExitBreakpointCommand(classID, methodID int64, suspendPolicy byte) []byte {
	w := NewJDWPDataWriter()
	w.WriteByte(eventKindBreakpoint)
	w.WriteByte(suspendPolicy)
	w.WriteInt(1)

	// LocationOnly at the last line (approximation)
	w.WriteByte(7) // ModKind.LocationOnly
	w.WriteByte(1) // typeTag
	w.WriteObjectID(classID)
	w.WriteObjectID(methodID)
	w.WriteLong(int64(0x7FFFFFFF)) // max line = last line approximation

	return w.Bytes()
}

// BuildClearBreakpointCommand builds an EventRequest.Clear command
// for a breakpoint event.
func BuildClearBreakpointCommand(requestID int32) []byte {
	w := NewJDWPDataWriter()
	w.WriteByte(eventKindBreakpoint)
	w.WriteInt(requestID)
	return w.Bytes()
}

// ── Breakpoint Location Matching ──────────────────────────────────

// MatchBreakpointLocation checks if a breakpoint event matches a
// given class and line number.
func MatchBreakpointLocation(bp *Breakpoint, className string, lineNumber int32) bool {
	if bp.Kind != BreakpointLine {
		return false
	}
	if bp.ClassName != "" && bp.ClassName != className {
		return false
	}
	if bp.LineNumber != 0 && bp.LineNumber != lineNumber {
		return false
	}
	return true
}

// MatchMethodEntry checks if a breakpoint event matches a method
// entry event for the given class and method.
func MatchMethodEntry(bp *Breakpoint, className, methodName string) bool {
	if bp.Kind != BreakpointMethodEntry {
		return false
	}
	if bp.ClassName != "" && bp.ClassName != className {
		return false
	}
	if bp.MethodName != "" && bp.MethodName != methodName {
		return false
	}
	return true
}

// ── Breakpoint Sync ───────────────────────────────────────────────

// BreakpointSyncManager handles synchronization of breakpoints between
// frontend and backend (JDWP).
type BreakpointSyncManager struct {
	mu      sync.RWMutex
	manager *BreakpointManager
	// pendingSync tracks breakpoints that need to be sent to the JVM
	pendingSync map[int32]bool
	// jdwpRequestIDs maps local breakpoint IDs to JDWP request IDs
	jdwpRequestIDs map[int32]int32
}

// NewBreakpointSyncManager creates a new BreakpointSyncManager.
func NewBreakpointSyncManager(bm *BreakpointManager) *BreakpointSyncManager {
	return &BreakpointSyncManager{
		manager:        bm,
		pendingSync:    make(map[int32]bool),
		jdwpRequestIDs: make(map[int32]int32),
	}
}

// SyncBreakpoint marks a breakpoint as needing sync to JDWP.
func (bsm *BreakpointSyncManager) SyncBreakpoint(id int32) {
	bsm.mu.Lock()
	defer bsm.mu.Unlock()
	bsm.pendingSync[id] = true
}

// GetPendingSyncs returns all breakpoint IDs that need syncing.
func (bsm *BreakpointSyncManager) GetPendingSyncs() []int32 {
	bsm.mu.RLock()
	defer bsm.mu.RUnlock()

	result := make([]int32, 0, len(bsm.pendingSync))
	for id := range bsm.pendingSync {
		result = append(result, id)
	}
	return result
}

// MarkSynced marks a breakpoint as synced and stores the JDWP request ID.
func (bsm *BreakpointSyncManager) MarkSynced(id int32, jdwpRequestID int32) {
	bsm.mu.Lock()
	defer bsm.mu.Unlock()

	delete(bsm.pendingSync, id)
	bsm.jdwpRequestIDs[id] = jdwpRequestID
}

// GetJDWPRequestID returns the JDWP request ID for a breakpoint.
func (bsm *BreakpointSyncManager) GetJDWPRequestID(id int32) (int32, bool) {
	bsm.mu.RLock()
	defer bsm.mu.RUnlock()

	reqID, ok := bsm.jdwpRequestIDs[id]
	return reqID, ok
}

// RemoveJDWPRequestID removes the JDWP request ID mapping.
func (bsm *BreakpointSyncManager) RemoveJDWPRequestID(id int32) {
	bsm.mu.Lock()
	defer bsm.mu.Unlock()

	delete(bsm.pendingSync, id)
	delete(bsm.jdwpRequestIDs, id)
}

// Clear clears all sync state.
func (bsm *BreakpointSyncManager) Clear() {
	bsm.mu.Lock()
	defer bsm.mu.Unlock()

	bsm.pendingSync = make(map[int32]bool)
	bsm.jdwpRequestIDs = make(map[int32]int32)
}

// PendingCount returns the number of pending syncs.
func (bsm *BreakpointSyncManager) PendingCount() int {
	bsm.mu.RLock()
	defer bsm.mu.RUnlock()
	return len(bsm.pendingSync)
}

// ── Batch Operations ──────────────────────────────────────────────

// BatchBreakpointUpdate represents a batch of breakpoint changes
// to apply atomically.
type BatchBreakpointUpdate struct {
	Adds    []*Breakpoint `json:"adds,omitempty"`
	Removes []int32       `json:"removes,omitempty"`
	Updates map[int32]*Breakpoint `json:"updates,omitempty"`
}

// ApplyBatch applies a batch of breakpoint changes.
func (bm *BreakpointManager) ApplyBatch(batch *BatchBreakpointUpdate) (addedIDs []int32, errors []string) {
	for _, bp := range batch.Adds {
		id := bm.AddBreakpoint(bp)
		addedIDs = append(addedIDs, id)
	}

	for _, id := range batch.Removes {
		if err := bm.RemoveBreakpoint(id); err != nil {
			errors = append(errors, fmt.Sprintf("remove %d: %s", id, err.Error()))
		}
	}

	for id, bp := range batch.Updates {
		if err := bm.UpdateBreakpoint(id, bp); err != nil {
			errors = append(errors, fmt.Sprintf("update %d: %s", id, err.Error()))
		}
	}

	return addedIDs, errors
}

// ── Breakpoint Filtering ──────────────────────────────────────────

// BreakpointFilter provides filtering options for listing breakpoints.
type BreakpointFilter struct {
	Kind      BreakpointKind `json:"kind,omitempty"`
	ClassName string         `json:"className,omitempty"`
	Enabled   *bool          `json:"enabled,omitempty"`
	SourceURI string         `json:"sourceUri,omitempty"`
}

// FilterBreakpoints returns breakpoints matching the filter.
func (bm *BreakpointManager) FilterBreakpoints(filter *BreakpointFilter) []*Breakpoint {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	var result []*Breakpoint
	for _, bp := range bm.breakpoints {
		if filter.Kind != "" && bp.Kind != filter.Kind {
			continue
		}
		if filter.ClassName != "" && !strings.Contains(bp.ClassName, filter.ClassName) {
			continue
		}
		if filter.Enabled != nil && bp.Enabled != *filter.Enabled {
			continue
		}
		if filter.SourceURI != "" && bp.SourceURI != filter.SourceURI {
			continue
		}
		result = append(result, bp)
	}
	return result
}

// ── Cross-Module Breakpoints ──────────────────────────────────────

// CrossModuleBreakpoint extends Breakpoint with multi-module support.
// It allows breakpoints to be set across JAR/WAR module boundaries
// using classpath pattern matching.
type CrossModuleBreakpoint struct {
	Breakpoint
	// ModuleName is the Maven/Gradle module name (e.g., "core", "webapp").
	ModuleName string `json:"moduleName,omitempty"`
	// ModulePattern is a glob pattern matching classpaths across modules.
	// e.g., "com/example/**", "**/service/*.java"
	ModulePattern string `json:"modulePattern,omitempty"`
	// JarPattern is a glob pattern matching JAR/WAR filenames.
	// e.g., "WEB-INF/lib/my-lib-*.jar"
	JarPattern string `json:"jarPattern,omitempty"`
	// IsDeferred indicates this breakpoint is waiting for its class to load.
	IsDeferred bool `json:"isDeferred"`
	// DeferredClassPattern is the class name pattern for deferred resolution.
	DeferredClassPattern string `json:"deferredClassPattern,omitempty"`
	// ResolvedClassNames lists all classes that matched this breakpoint after resolution.
	ResolvedClassNames []string `json:"resolvedClassNames,omitempty"`
}

// CrossModuleBreakpointManager manages breakpoints across multiple modules.
type CrossModuleBreakpointManager struct {
	mu          sync.RWMutex
	baseManager *BreakpointManager
	// moduleBreakpoints maps module name → breakpoint IDs
	moduleBreakpoints map[string]map[int32]bool
	// deferredBreakpoints are breakpoints waiting for class load
	deferredBreakpoints []*CrossModuleBreakpoint
	// classPatternIndex maps class name patterns → breakpoint IDs
	classPatternIndex map[string][]int32
	// persistencePath is the file path for breakpoint persistence
	persistencePath string
}

// NewCrossModuleBreakpointManager creates a new cross-module breakpoint manager.
func NewCrossModuleBreakpointManager(bm *BreakpointManager) *CrossModuleBreakpointManager {
	cm := &CrossModuleBreakpointManager{
		baseManager:        bm,
		moduleBreakpoints:  make(map[string]map[int32]bool),
		deferredBreakpoints: make([]*CrossModuleBreakpoint, 0),
		classPatternIndex:  make(map[string][]int32),
	}
	return cm
}

// SetPersistencePath sets the file path for breakpoint persistence.
func (cm *CrossModuleBreakpointManager) SetPersistencePath(path string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.persistencePath = path
}

// AddCrossModuleBreakpoint adds a breakpoint with cross-module support.
// If the class pattern contains wildcards, the breakpoint is deferred
// until matching classes are loaded.
func (cm *CrossModuleBreakpointManager) AddCrossModuleBreakpoint(cbp *CrossModuleBreakpoint) int32 {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	id := cm.baseManager.AddBreakpoint(&cbp.Breakpoint)

	// Track by module
	if cbp.ModuleName != "" {
		if cm.moduleBreakpoints[cbp.ModuleName] == nil {
			cm.moduleBreakpoints[cbp.ModuleName] = make(map[int32]bool)
		}
		cm.moduleBreakpoints[cbp.ModuleName][id] = true
	}

	// Check if this is a deferred breakpoint
	if cbp.DeferredClassPattern != "" || hasWildcard(cbp.ClassName) {
		cbp.IsDeferred = true
		cm.deferredBreakpoints = append(cm.deferredBreakpoints, cbp)
		cm.indexClassPattern(id, cbp.ClassName)
	}

	return id
}

// GetModuleBreakpoints returns all breakpoints for a given module.
func (cm *CrossModuleBreakpointManager) GetModuleBreakpoints(moduleName string) []*Breakpoint {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	ids, ok := cm.moduleBreakpoints[moduleName]
	if !ok {
		return nil
	}

	result := make([]*Breakpoint, 0, len(ids))
	for id := range ids {
		if bp, ok := cm.baseManager.GetBreakpoint(id); ok {
			result = append(result, bp)
		}
	}
	return result
}

// GetDeferredBreakpoints returns all breakpoints waiting for class load.
func (cm *CrossModuleBreakpointManager) GetDeferredBreakpoints() []*CrossModuleBreakpoint {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	result := make([]*CrossModuleBreakpoint, len(cm.deferredBreakpoints))
	copy(result, cm.deferredBreakpoints)
	return result
}

// DeferredCount returns the number of breakpoints awaiting class load.
func (cm *CrossModuleBreakpointManager) DeferredCount() int {
	cm.mu.RLock()
	defer cm.mu.RUnlock()
	return len(cm.deferredBreakpoints)
}

// OnClassPrepare is called when a class is loaded. It resolves any
// deferred breakpoints that match the newly loaded class.
func (cm *CrossModuleBreakpointManager) OnClassPrepare(className string) []*Breakpoint {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	var resolved []*Breakpoint
	remaining := make([]*CrossModuleBreakpoint, 0, len(cm.deferredBreakpoints))

	for _, cbp := range cm.deferredBreakpoints {
		if matchClassPattern(cbp.ClassName, className) || matchClassPattern(cbp.DeferredClassPattern, className) {
			// Resolve: update the breakpoint with the actual class name
			if bp, ok := cm.baseManager.GetBreakpoint(cbp.ID); ok {
				bp.ClassName = className
				cbp.IsDeferred = false
				cbp.ResolvedClassNames = append(cbp.ResolvedClassNames, className)
				resolved = append(resolved, bp)
			}
		} else {
			remaining = append(remaining, cbp)
		}
	}

	cm.deferredBreakpoints = remaining
	return resolved
}

// OnClassUnload is called when a class is unloaded.
func (cm *CrossModuleBreakpointManager) OnClassUnload(className string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	// Clean up resolved class names
	for _, cbp := range cm.deferredBreakpoints {
		filtered := make([]string, 0, len(cbp.ResolvedClassNames))
		for _, name := range cbp.ResolvedClassNames {
			if name != className {
				filtered = append(filtered, name)
			}
		}
		cbp.ResolvedClassNames = filtered
	}
}

// ListModuleBreakpoints returns all breakpoints grouped by module.
func (cm *CrossModuleBreakpointManager) ListModuleBreakpoints() map[string][]*Breakpoint {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	result := make(map[string][]*Breakpoint)
	for moduleName, ids := range cm.moduleBreakpoints {
		bps := make([]*Breakpoint, 0, len(ids))
		for id := range ids {
			if bp, ok := cm.baseManager.GetBreakpoint(id); ok {
				bps = append(bps, bp)
			}
		}
		result[moduleName] = bps
	}
	return result
}

// SetBreakpointOnAllModules sets a breakpoint on all modules matching
// the given class name pattern.
func (cm *CrossModuleBreakpointManager) SetBreakpointOnAllModules(className string, lineNumber int32, modulePattern string, jarPattern string) []int32 {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	cbp := &CrossModuleBreakpoint{
		Breakpoint: Breakpoint{
			Kind:       BreakpointLine,
			ClassName:  className,
			LineNumber: lineNumber,
		},
		ModulePattern:  modulePattern,
		JarPattern:     jarPattern,
		IsDeferred:     hasWildcard(className),
		DeferredClassPattern: className,
	}

	id := cm.baseManager.AddBreakpoint(&cbp.Breakpoint)
	cbp.ID = id

	if cbp.IsDeferred {
		cm.deferredBreakpoints = append(cm.deferredBreakpoints, cbp)
		cm.indexClassPattern(id, className)
	}

	return []int32{id}
}

func (cm *CrossModuleBreakpointManager) indexClassPattern(id int32, pattern string) {
	if pattern != "" {
		cm.classPatternIndex[pattern] = append(cm.classPatternIndex[pattern], id)
	}
}

// ── Classpath Pattern Matching ─────────────────────────────────────

// wildcardRE matches * and ** patterns in class names and paths.
var wildcardRE = regexp.MustCompile(`[*?]`)

// hasWildcard returns true if the pattern contains wildcard characters.
func hasWildcard(pattern string) bool {
	return wildcardRE.MatchString(pattern)
}

// matchClassPattern checks if a class name matches a pattern.
// Supports:
//   - Exact match: "com.example.MyClass"
//   - Single wildcard: "com.example.*" → matches "com.example.MyClass"
//   - Double wildcard: "com.example.**" → matches "com.example.foo.bar.MyClass"
//   - Path-style: "com/example/**" → matches "com.example.foo.MyClass"
//   - Suffix match: "*Service" → matches "com.example.UserService"
func matchClassPattern(pattern, className string) bool {
	if pattern == "" {
		return false
	}
	if pattern == className {
		return true
	}

	// Normalize path separators to dots
	pattern = strings.ReplaceAll(pattern, "/", ".")
	className = strings.ReplaceAll(className, "/", ".")

	// Handle ** (double wildcard): matches any number of package segments
	if strings.Contains(pattern, "**") {
		parts := strings.SplitN(pattern, "**", 2)
		prefix := parts[0]
		suffix := ""
		if len(parts) > 1 {
			suffix = parts[1]
		}
		// Remove trailing dot from prefix if present
		prefix = strings.TrimSuffix(prefix, ".")
		suffix = strings.TrimPrefix(suffix, ".")

		if prefix != "" && !strings.HasPrefix(className, prefix) {
			return false
		}
		if suffix != "" && !strings.HasSuffix(className, suffix) {
			return false
		}
		return true
	}

	// Handle * (single wildcard)
	if strings.Contains(pattern, "*") {
		// If pattern contains no dots, it's a simple filename/suffix match
		// where * should match any characters including dots (e.g., "*Service").
		// If pattern contains dots, * matches a single package segment.
		wildcardReplacement := `[^.]+`
		if !strings.Contains(pattern, ".") {
			wildcardReplacement = `.*`
		}
		// Convert pattern to regex
		rePattern := "^" + strings.ReplaceAll(regexp.QuoteMeta(pattern), `\*`, wildcardReplacement) + "$"
		matched, err := regexp.MatchString(rePattern, className)
		if err != nil {
			return false
		}
		return matched
	}

	return false
}

// MatchClasspathPattern checks if a classpath entry matches a glob pattern.
// e.g., "WEB-INF/lib/*.jar" matches "WEB-INF/lib/my-lib.jar"
func MatchClasspathPattern(pattern, classpath string) bool {
	matched, err := filepath.Match(pattern, classpath)
	if err != nil {
		// Fall back to simple contains check
		return strings.Contains(classpath, strings.Trim(pattern, "*"))
	}
	return matched
}

// ── Breakpoint Persistence ────────────────────────────────────────

// PersistBreakpoints saves all breakpoints to a JSON file.
// Returns the number of breakpoints saved.
func (cm *CrossModuleBreakpointManager) PersistBreakpoints() (int, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	if cm.persistencePath == "" {
		return 0, fmt.Errorf("persistence path not set")
	}

	bps := cm.baseManager.ListBreakpoints()
	type persistedBP struct {
		ID             int32          `json:"id"`
		Kind           BreakpointKind `json:"kind"`
		ClassName      string         `json:"className"`
		MethodName     string         `json:"methodName,omitempty"`
		FieldName      string         `json:"fieldName,omitempty"`
		LineNumber     int32          `json:"lineNumber"`
		Enabled        bool           `json:"enabled"`
		Condition      string         `json:"condition,omitempty"`
		HitCountMode   HitCountMode   `json:"hitCountMode,omitempty"`
		HitCountTarget int64          `json:"hitCountTarget,omitempty"`
		LogMessage     string         `json:"logMessage,omitempty"`
		SourceURI      string         `json:"sourceUri,omitempty"`
		SuspendPolicy  byte           `json:"suspendPolicy"`
		ModuleName     string         `json:"moduleName,omitempty"`
		ModulePattern  string         `json:"modulePattern,omitempty"`
	}

	persisted := make([]persistedBP, 0, len(bps))
	for _, bp := range bps {
		p := persistedBP{
			ID:             bp.ID,
			Kind:           bp.Kind,
			ClassName:      bp.ClassName,
			MethodName:     bp.MethodName,
			FieldName:      bp.FieldName,
			LineNumber:     bp.LineNumber,
			Enabled:        bp.Enabled,
			Condition:      bp.Condition,
			HitCountMode:   bp.HitCountMode,
			HitCountTarget: bp.HitCountTarget,
			LogMessage:     bp.LogMessage,
			SourceURI:      bp.SourceURI,
			SuspendPolicy:  bp.SuspendPolicy,
		}
		// Look up module info
		for moduleName, ids := range cm.moduleBreakpoints {
			if ids[bp.ID] {
				p.ModuleName = moduleName
				break
			}
		}
		persisted = append(persisted, p)
	}

	data, err := json.MarshalIndent(persisted, "", "  ")
	if err != nil {
		return 0, fmt.Errorf("marshal breakpoints: %w", err)
	}

	dir := filepath.Dir(cm.persistencePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return 0, fmt.Errorf("create persistence dir: %w", err)
	}

	if err := os.WriteFile(cm.persistencePath, data, 0644); err != nil {
		return 0, fmt.Errorf("write breakpoints file: %w", err)
	}

	return len(persisted), nil
}

// RestoreBreakpoints loads breakpoints from a JSON file.
// Returns the number of breakpoints restored.
func (cm *CrossModuleBreakpointManager) RestoreBreakpoints() (int, error) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if cm.persistencePath == "" {
		return 0, fmt.Errorf("persistence path not set")
	}

	data, err := os.ReadFile(cm.persistencePath)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil // No file yet, not an error
		}
		return 0, fmt.Errorf("read breakpoints file: %w", err)
	}

	type persistedBP struct {
		ID             int32          `json:"id"`
		Kind           BreakpointKind `json:"kind"`
		ClassName      string         `json:"className"`
		MethodName     string         `json:"methodName,omitempty"`
		FieldName      string         `json:"fieldName,omitempty"`
		LineNumber     int32          `json:"lineNumber"`
		Enabled        bool           `json:"enabled"`
		Condition      string         `json:"condition,omitempty"`
		HitCountMode   HitCountMode   `json:"hitCountMode,omitempty"`
		HitCountTarget int64          `json:"hitCountTarget,omitempty"`
		LogMessage     string         `json:"logMessage,omitempty"`
		SourceURI      string         `json:"sourceUri,omitempty"`
		SuspendPolicy  byte           `json:"suspendPolicy"`
		ModuleName     string         `json:"moduleName,omitempty"`
		ModulePattern  string         `json:"modulePattern,omitempty"`
	}

	var persisted []persistedBP
	if err := json.Unmarshal(data, &persisted); err != nil {
		return 0, fmt.Errorf("unmarshal breakpoints: %w", err)
	}

	count := 0
	for _, p := range persisted {
		bp := &Breakpoint{
			Kind:           p.Kind,
			ClassName:      p.ClassName,
			MethodName:     p.MethodName,
			FieldName:      p.FieldName,
			LineNumber:     p.LineNumber,
			Enabled:        p.Enabled,
			Condition:      p.Condition,
			HitCountMode:   p.HitCountMode,
			HitCountTarget: p.HitCountTarget,
			LogMessage:     p.LogMessage,
			SourceURI:      p.SourceURI,
			SuspendPolicy:  p.SuspendPolicy,
		}
		id := cm.baseManager.AddBreakpoint(bp)
		if p.ModuleName != "" {
			if cm.moduleBreakpoints[p.ModuleName] == nil {
				cm.moduleBreakpoints[p.ModuleName] = make(map[int32]bool)
			}
			cm.moduleBreakpoints[p.ModuleName][id] = true
		}
		count++
	}

	return count, nil
}

// ── Complex Condition Evaluation ──────────────────────────────────

// ConditionOperator defines a logical operator for complex conditions.
type ConditionOperator string

const (
	OpAND ConditionOperator = "AND"
	OpOR  ConditionOperator = "OR"
	OpNOT ConditionOperator = "NOT"
)

// ComplexCondition represents a compound breakpoint condition.
type ComplexCondition struct {
	Operator ConditionOperator  `json:"operator"`
	Left     *ComplexCondition  `json:"left,omitempty"`
	Right    *ComplexCondition  `json:"right,omitempty"`
	Operand  string             `json:"operand,omitempty"` // Simple condition string
}

// ParseComplexCondition parses a condition string with AND/OR/NOT operators.
// Supports formats like:
//   - "x > 5 && y < 10"
//   - "x > 5 || y < 10"
//   - "!(x > 5)"
func ParseComplexCondition(condition string) *ComplexCondition {
	condition = strings.TrimSpace(condition)
	if condition == "" {
		return nil
	}

	// Check for NOT
	if strings.HasPrefix(condition, "!") {
		inner := strings.TrimSpace(condition[1:])
		// Remove surrounding parens if present
		inner = strings.TrimPrefix(inner, "(")
		inner = strings.TrimSuffix(inner, ")")
		return &ComplexCondition{
			Operator: OpNOT,
			Left:     ParseComplexCondition(inner),
		}
	}

	// Check for AND (&&) — lower precedence, so split first
	if andIdx := findOperatorIndex(condition, "&&"); andIdx >= 0 {
		left := strings.TrimSpace(condition[:andIdx])
		right := strings.TrimSpace(condition[andIdx+2:])
		// Remove surrounding parens
		left = strings.TrimPrefix(left, "(")
		left = strings.TrimSuffix(left, ")")
		right = strings.TrimPrefix(right, "(")
		right = strings.TrimSuffix(right, ")")
		return &ComplexCondition{
			Operator: OpAND,
			Left:     ParseComplexCondition(left),
			Right:    ParseComplexCondition(right),
		}
	}

	// Check for OR (||) — higher precedence than AND for split
	if orIdx := findOperatorIndex(condition, "||"); orIdx >= 0 {
		left := strings.TrimSpace(condition[:orIdx])
		right := strings.TrimSpace(condition[orIdx+2:])
		left = strings.TrimPrefix(left, "(")
		left = strings.TrimSuffix(left, ")")
		right = strings.TrimPrefix(right, "(")
		right = strings.TrimSuffix(right, ")")
		return &ComplexCondition{
			Operator: OpOR,
			Left:     ParseComplexCondition(left),
			Right:    ParseComplexCondition(right),
		}
	}

	// Leaf: simple condition
	return &ComplexCondition{Operand: condition}
}

// findOperatorIndex finds the index of an operator (&& or ||) that is
// not inside parentheses.
func findOperatorIndex(s, op string) int {
	depth := 0
	for i := 0; i < len(s)-len(op)+1; i++ {
		switch s[i] {
		case '(':
			depth++
		case ')':
			depth--
		default:
			if depth == 0 && s[i:i+len(op)] == op {
				// For &&, make sure we're not matching inside a non-existent operator
				if op == "&&" {
					// Check it's not part of || or other tokens
					if i+2 < len(s) && s[i+2] == '&' {
						continue
					}
				}
				return i
			}
		}
	}
	return -1
}

// EvaluateComplexCondition evaluates a complex condition tree against variables.
func EvaluateComplexCondition(cc *ComplexCondition, vars map[string]interface{}) bool {
	if cc == nil {
		return true
	}

	switch cc.Operator {
	case OpAND:
		leftResult := EvaluateComplexCondition(cc.Left, vars)
		rightResult := EvaluateComplexCondition(cc.Right, vars)
		return leftResult && rightResult

	case OpOR:
		leftResult := EvaluateComplexCondition(cc.Left, vars)
		rightResult := EvaluateComplexCondition(cc.Right, vars)
		return leftResult || rightResult

	case OpNOT:
		return !EvaluateComplexCondition(cc.Left, vars)

	default:
		// Leaf operand
		if cc.Operand == "" {
			return true
		}
		return EvaluateBreakpointCondition(cc.Operand, vars)
	}
}

// ── Instance Filters ──────────────────────────────────────────────

// InstanceFilter allows filtering breakpoints by object instance.
type InstanceFilter struct {
	// ObjectID is the JDWP object ID to filter on.
	ObjectID int64 `json:"objectId"`
	// Expression is a condition like "this == obj" or "this != null".
	Expression string `json:"expression,omitempty"`
}

// MatchInstanceFilter checks if a breakpoint should trigger based on
// an instance filter. The thisObj is the "this" reference at the
// breakpoint site.
func (f *InstanceFilter) MatchInstanceFilter(thisObj interface{}) bool {
	if f == nil || f.ObjectID == 0 {
		return true
	}

	// If we have a concrete object ID, compare
	if id, ok := thisObj.(int64); ok {
		return id == f.ObjectID
	}

	return true
}

// ── Thread Filters ────────────────────────────────────────────────

// ThreadFilter allows filtering breakpoints by thread.
type ThreadFilter struct {
	// ThreadID is the JDWP thread ID to filter on.
	ThreadID int64 `json:"threadId"`
	// ThreadName is a human-readable name for display.
	ThreadName string `json:"threadName,omitempty"`
	// ThreadNamePattern is a glob pattern for thread name matching.
	ThreadNamePattern string `json:"threadNamePattern,omitempty"`
}

// MatchThreadFilter checks if a breakpoint should trigger for a given thread.
func (f *ThreadFilter) MatchThreadFilter(threadID int64, threadName string) bool {
	if f == nil {
		return true
	}

	if f.ThreadID != 0 && threadID != f.ThreadID {
		return false
	}

	if f.ThreadNamePattern != "" {
		matched, err := filepath.Match(f.ThreadNamePattern, threadName)
		if err != nil || !matched {
			return false
		}
	}

	return true
}

// ── Call Stack Depth Filter ────────────────────────────────────────

// StackDepthFilter allows filtering breakpoints by call stack depth.
type StackDepthFilter struct {
	// MinDepth is the minimum stack depth (0 = current frame).
	MinDepth int32 `json:"minDepth"`
	// MaxDepth is the maximum stack depth (-1 = no limit).
	MaxDepth int32 `json:"maxDepth"`
}

// MatchStackDepth checks if the current call stack depth satisfies the filter.
func (f *StackDepthFilter) MatchStackDepth(currentDepth int32) bool {
	if f == nil {
		return true
	}

	if f.MinDepth > 0 && currentDepth < f.MinDepth {
		return false
	}
	if f.MaxDepth > 0 && currentDepth > f.MaxDepth {
		return false
	}

	return true
}

// ── Enhanced Breakpoint with All Filters ──────────────────────────

// EnhancedBreakpoint extends Breakpoint with all Phase 3+ filter capabilities.
type EnhancedBreakpoint struct {
	Breakpoint
	// ModuleName for cross-module breakpoints.
	ModuleName string `json:"moduleName,omitempty"`
	// ComplexCondition for AND/OR/NOT expressions.
	ComplexCondition *ComplexCondition `json:"complexCondition,omitempty"`
	// InstanceFilter for "this == obj" filtering.
	InstanceFilter *InstanceFilter `json:"instanceFilter,omitempty"`
	// ThreadFilter for thread-specific breakpoints.
	ThreadFilter *ThreadFilter `json:"threadFilter,omitempty"`
	// StackDepthFilter for call stack depth filtering.
	StackDepthFilter *StackDepthFilter `json:"stackDepthFilter,omitempty"`
	// IsDeferred indicates this breakpoint is pending class load.
	IsDeferred bool `json:"isDeferred"`
}

// ShouldTrigger evaluates all filters and returns whether the breakpoint
// should trigger given the current debug context.
func (eb *EnhancedBreakpoint) ShouldTrigger(vars map[string]interface{}, thisObj interface{}, threadID int64, threadName string, stackDepth int32) bool {
	if !eb.Enabled {
		return false
	}

	// Evaluate complex condition
	if eb.ComplexCondition != nil {
		if !EvaluateComplexCondition(eb.ComplexCondition, vars) {
			return false
		}
	} else if eb.Condition != "" {
		if !EvaluateBreakpointCondition(eb.Condition, vars) {
			return false
		}
	}

	// Evaluate instance filter
	if eb.InstanceFilter != nil {
		if !eb.InstanceFilter.MatchInstanceFilter(thisObj) {
			return false
		}
	}

	// Evaluate thread filter
	if eb.ThreadFilter != nil {
		if !eb.ThreadFilter.MatchThreadFilter(threadID, threadName) {
			return false
		}
	}

	// Evaluate stack depth filter
	if eb.StackDepthFilter != nil {
		if !eb.StackDepthFilter.MatchStackDepth(stackDepth) {
			return false
		}
	}

	// Evaluate hit count
	if !EvaluateHitCount(&eb.Breakpoint) {
		return false
	}

	return true
}

// BuildEnhancedBreakpointSetCommand builds a JDWP EventRequest.Set command
// with all modifiers for an enhanced breakpoint.
func BuildEnhancedBreakpointSetCommand(classID, methodID int64, lineNumber int32, eb *EnhancedBreakpoint) []byte {
	w := NewJDWPDataWriter()
	w.WriteByte(eventKindBreakpoint)
	w.WriteByte(eb.SuspendPolicy)

	// Count modifiers
	modifierCount := int32(1) // LocationOnly
	if eb.ThreadFilter != nil && eb.ThreadFilter.ThreadID != 0 {
		modifierCount++
	}
	if eb.InstanceFilter != nil && eb.InstanceFilter.ObjectID != 0 {
		modifierCount++
	}
	// Conditions are evaluated on hit (RecordHitAndShouldStop). HotSpot does
	// not implement JDWP Conditional (modKind 2); do not emit a fake modifier.

	w.WriteInt(modifierCount)

	// LocationOnly modifier
	w.WriteByte(7) // ModKind.LocationOnly = 7
	w.WriteByte(1) // typeTag (1 = class)
	w.WriteObjectID(classID)
	w.WriteObjectID(methodID)
	w.WriteLong(int64(lineNumber))

	// ThreadOnly modifier (if specified)
	if eb.ThreadFilter != nil && eb.ThreadFilter.ThreadID != 0 {
		w.WriteByte(3) // ModKind.ThreadOnly = 3
		w.WriteObjectID(eb.ThreadFilter.ThreadID)
	}

	// InstanceOnly modifier (if specified)
	if eb.InstanceFilter != nil && eb.InstanceFilter.ObjectID != 0 {
		w.WriteByte(5) // ModKind.InstanceOnly = 5
		w.WriteObjectID(eb.InstanceFilter.ObjectID)
	}

	return w.Bytes()
}

// complexConditionToString converts a ComplexCondition tree back to a string.
func complexConditionToString(cc *ComplexCondition) string {
	if cc == nil {
		return ""
	}
	switch cc.Operator {
	case OpAND:
		return "(" + complexConditionToString(cc.Left) + " && " + complexConditionToString(cc.Right) + ")"
	case OpOR:
		return "(" + complexConditionToString(cc.Left) + " || " + complexConditionToString(cc.Right) + ")"
	case OpNOT:
		return "!(" + complexConditionToString(cc.Left) + ")"
	default:
		return cc.Operand
	}
}