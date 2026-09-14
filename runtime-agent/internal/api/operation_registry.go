package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

// OperationKind identifies the type of mutating operation.
type OperationKind string

const (
	OpBuild       OperationKind = "build"
	OpDeploy      OperationKind = "deploy"
	OpServerStart OperationKind = "server-start"
	OpCustomBuild OperationKind = "custom-build"
	OpHotswap     OperationKind = "hotswap"
)

// OperationKey uniquely identifies an operation by scope, kind, and client requestId (F20 / T25, T26).
type OperationKey struct {
	Scope     string        // ProjectID, ServerID, etc.
	Kind      OperationKind // "build", "deploy", etc.
	RequestID string
}

func (k OperationKey) String() string {
	return fmt.Sprintf("%s:%s:%s", k.Scope, k.Kind, k.RequestID)
}

// OperationState represents the lifecycle stage of an operation.
type OperationState string

const (
	OpStateExecuting OperationState = "executing"
	OpStateCompleted OperationState = "completed"
	OpStateFailed    OperationState = "failed"
)

// ClaimResult defines the result of attempting to claim an operation.
type ClaimResult int

const (
	// ClaimResultExecute: caller won execution rights; caller MUST execute side-effects and call Finish.
	ClaimResultExecute ClaimResult = iota
	// ClaimResultReplay: identical operation was already completed (or completed while waiting); cached response available.
	ClaimResultReplay
	// ClaimResultConflict: an operation with the same key exists but with a different payload hash (HTTP 409 Conflict).
	ClaimResultConflict
	// ClaimResultCancelled: waiter's context was cancelled while waiting for winner goroutine.
	ClaimResultCancelled
)

// OperationRecord holds the state, fingerprint, and cached result of an operation.
type OperationRecord struct {
	Key         OperationKey
	PayloadHash string
	State       OperationState
	StatusCode  int
	Response    []byte
	ErrorMsg    string
	CreatedAt   time.Time
	CompletedAt time.Time

	done chan struct{} // closed when State transitions away from OpStateExecuting
}

// OperationRegistry provides atomic execution deduplication, payload fingerprinting,
// and concurrency coalescing for state-mutating requests (F20 / T25, T26).
type OperationRegistry struct {
	mu         sync.Mutex
	records    map[string]*OperationRecord
	byKindReq  map[string]*OperationRecord
	ttl        time.Duration
	maxEntries int
}

// NewOperationRegistry creates a new operation registry.
func NewOperationRegistry(ttl time.Duration, maxEntries int) *OperationRegistry {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	if maxEntries <= 0 {
		maxEntries = 512
	}
	return &OperationRegistry{
		records:    make(map[string]*OperationRecord),
		byKindReq:  make(map[string]*OperationRecord),
		ttl:        ttl,
		maxEntries: maxEntries,
	}
}

// HashPayload calculates the SHA-256 fingerprint for a request payload.
func HashPayload(payload []byte) string {
	h := sha256.Sum256(payload)
	return hex.EncodeToString(h[:])
}

// ClaimOrWait attempts to claim execution rights for an operation key with the given payload.
// If another goroutine is currently executing the exact same operation, it waits until completion
// or context cancellation.
// Returns ClaimResultExecute, ClaimResultReplay, ClaimResultConflict, or ClaimResultCancelled.
func (r *OperationRegistry) ClaimOrWait(ctx context.Context, key OperationKey, payload []byte) (ClaimResult, *OperationRecord) {
	if key.RequestID == "" {
		// Non-idempotent request without requestId; execute directly.
		return ClaimResultExecute, nil
	}

	payloadHash := HashPayload(payload)
	keyStr := key.String()
	kindReqKey := fmt.Sprintf("%s:%s", key.Kind, key.RequestID)

	r.mu.Lock()
	r.evictExpiredLocked()

	// Check by Kind:RequestID to eliminate cross-Kind collisions while detecting same-Kind payload conflicts
	rec, exists := r.byKindReq[kindReqKey]
	if !exists {
		rec, exists = r.records[keyStr]
	}

	if !exists {
		// First caller wins execution right
		rec = &OperationRecord{
			Key:         key,
			PayloadHash: payloadHash,
			State:       OpStateExecuting,
			CreatedAt:   time.Now(),
			done:        make(chan struct{}),
		}
		r.records[keyStr] = rec
		r.byKindReq[kindReqKey] = rec
		r.mu.Unlock()
		return ClaimResultExecute, rec
	}

	// Record already exists: check payload fingerprint for conflicts (F20 / T26)
	if rec.PayloadHash != payloadHash {
		r.mu.Unlock()
		return ClaimResultConflict, rec
	}

	// Payload matches: check if already completed or failed
	if rec.State == OpStateCompleted || rec.State == OpStateFailed {
		r.mu.Unlock()
		return ClaimResultReplay, rec
	}

	// Currently executing: wait for winner goroutine to finalize (F20 / T25)
	doneChan := rec.done
	r.mu.Unlock()

	select {
	case <-doneChan:
		r.mu.Lock()
		latestRec := r.byKindReq[kindReqKey]
		if latestRec == nil {
			latestRec = r.records[keyStr]
		}
		r.mu.Unlock()
		if latestRec != nil {
			return ClaimResultReplay, latestRec
		}
		return ClaimResultReplay, rec
	case <-ctx.Done():
		return ClaimResultCancelled, rec
	}
}

// Finish completes an in-flight operation and unblocks all waiting goroutines.
func (r *OperationRegistry) Finish(key OperationKey, statusCode int, response []byte, err error) {
	if key.RequestID == "" {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	keyStr := key.String()
	kindReqKey := fmt.Sprintf("%s:%s", key.Kind, key.RequestID)

	rec, exists := r.records[keyStr]
	if !exists {
		rec = r.byKindReq[kindReqKey]
	}
	if rec == nil {
		rec = &OperationRecord{
			Key:       key,
			CreatedAt: time.Now(),
			done:      make(chan struct{}),
		}
		r.records[keyStr] = rec
		r.byKindReq[kindReqKey] = rec
	}

	rec.StatusCode = statusCode
	if len(response) > 0 {
		rec.Response = make([]byte, len(response))
		copy(rec.Response, response)
	}
	rec.CompletedAt = time.Now()

	if err != nil {
		rec.State = OpStateFailed
		rec.ErrorMsg = err.Error()
	} else {
		rec.State = OpStateCompleted
	}

	select {
	case <-rec.done:
		// already closed
	default:
		close(rec.done)
	}
}

// FinishByRequestID completes an in-flight operation by its client RequestID.
func (r *OperationRegistry) FinishByRequestID(requestID string, statusCode int, response []byte, err error) {
	if requestID == "" {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	var rec *OperationRecord
	for _, v := range r.records {
		if v.Key.RequestID == requestID {
			rec = v
			break
		}
	}
	if rec == nil {
		return
	}

	rec.StatusCode = statusCode
	if len(response) > 0 {
		rec.Response = make([]byte, len(response))
		copy(rec.Response, response)
	}
	rec.CompletedAt = time.Now()

	if err != nil {
		rec.State = OpStateFailed
		rec.ErrorMsg = err.Error()
	} else {
		rec.State = OpStateCompleted
	}

	select {
	case <-rec.done:
		// already closed
	default:
		close(rec.done)
	}
}

// GetStatus queries the current status of an operation (F20 / T25).
func (r *OperationRegistry) GetStatus(key OperationKey) (*OperationRecord, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rec, ok := r.records[key.String()]
	if !ok {
		rec, ok = r.byKindReq[fmt.Sprintf("%s:%s", key.Kind, key.RequestID)]
	}
	if !ok {
		return nil, false
	}
	cp := *rec
	return &cp, true
}

// GetStatusByRequestID queries the current status of an operation by request ID.
func (r *OperationRegistry) GetStatusByRequestID(requestID string) (*OperationRecord, bool) {
	if requestID == "" {
		return nil, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, v := range r.records {
		if v.Key.RequestID == requestID {
			cp := *v
			return &cp, true
		}
	}
	return nil, false
}

func (r *OperationRegistry) evictExpiredLocked() {
	now := time.Now()
	if len(r.records) < r.maxEntries {
		return
	}
	for k, v := range r.records {
		if v.State != OpStateExecuting && now.Sub(v.CompletedAt) > r.ttl {
			delete(r.records, k)
			if v.Key.RequestID != "" {
				delete(r.byKindReq, fmt.Sprintf("%s:%s", v.Key.Kind, v.Key.RequestID))
			}
		}
	}
	if len(r.records) >= r.maxEntries {
		var oldestKey string
		var oldestKindReq string
		var oldestTime time.Time
		for k, v := range r.records {
			if v.State != OpStateExecuting {
				if oldestTime.IsZero() || v.CompletedAt.Before(oldestTime) {
					oldestTime = v.CompletedAt
					oldestKey = k
					oldestKindReq = fmt.Sprintf("%s:%s", v.Key.Kind, v.Key.RequestID)
				}
			}
		}
		if oldestKey != "" {
			delete(r.records, oldestKey)
			if oldestKindReq != "" {
				delete(r.byKindReq, oldestKindReq)
			}
		}
	}
}
