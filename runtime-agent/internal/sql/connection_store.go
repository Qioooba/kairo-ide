package sql

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
)

// ConnectionStore is an in-memory registry of SQL connection configs
// keyed by connectionId. Used so /sql/execute can look up credentials
// registered during /sql/test-connection (even when the Instant Client
// stub still cannot open a real session).
type ConnectionStore struct {
	mu   sync.RWMutex
	byID map[string]ConnectionConfig
}

// NewConnectionStore creates an empty connection registry.
func NewConnectionStore() *ConnectionStore {
	return &ConnectionStore{byID: make(map[string]ConnectionConfig)}
}

// Register stores cfg under a new connectionId and returns that id.
func (s *ConnectionStore) Register(cfg ConnectionConfig) string {
	id := newConnectionID()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.byID == nil {
		s.byID = make(map[string]ConnectionConfig)
	}
	s.byID[id] = cfg
	return id
}

// Get returns the config for connectionId, if registered.
func (s *ConnectionStore) Get(connectionID string) (ConnectionConfig, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cfg, ok := s.byID[connectionID]
	return cfg, ok
}

// Delete removes a registered connection (best-effort).
func (s *ConnectionStore) Delete(connectionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.byID, connectionID)
}

// Len returns how many connections are currently registered.
func (s *ConnectionStore) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.byID)
}

func newConnectionID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "conn-fallback"
	}
	return "conn-" + hex.EncodeToString(b[:])
}
