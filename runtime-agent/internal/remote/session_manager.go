// Package remote implements the multi-user session manager for Phase 3+
// remote Linux agent functionality.
//
// Provides:
//   - Session lifecycle management (create, validate, refresh, terminate)
//   - Per-user session tracking
//   - Session expiry and cleanup
//   - Session limit enforcement
//   - Permission-based access control
//   - Active user counting
package remote

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sort"
	"sync"
	"time"
)

// UserSession represents an active user session.
type UserSession struct {
	ID          string            `json:"id"`
	UserID      string            `json:"userId"`
	Username    string            `json:"username"`
	Role        string            `json:"role"`
	CreatedAt   time.Time         `json:"createdAt"`
	ExpiresAt   time.Time         `json:"expiresAt"`
	LastActive  time.Time         `json:"lastActive"`
	Permissions []string          `json:"permissions"`
	Metadata    map[string]string `json:"metadata"`
}

// SessionManager manages user sessions for the remote agent.
type SessionManager struct {
	mu           sync.RWMutex
	sessions     map[string]*UserSession
	userSessions map[string][]string // userID -> session IDs
	maxSessions  int
	sessionTTL   time.Duration
}

// NewSessionManager creates a new session manager.
func NewSessionManager(maxSessions int, sessionTTL time.Duration) *SessionManager {
	if maxSessions <= 0 {
		maxSessions = 100
	}
	if sessionTTL <= 0 {
		sessionTTL = 8 * time.Hour
	}
	return &SessionManager{
		sessions:     make(map[string]*UserSession),
		userSessions: make(map[string][]string),
		maxSessions:  maxSessions,
		sessionTTL:   sessionTTL,
	}
}

// generateSessionID generates a cryptographically random session ID.
func generateSessionID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		h := hex.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
		return h
	}
	return hex.EncodeToString(b)
}

// CreateSession creates a new user session.
func (m *SessionManager) CreateSession(userID, username, role string, permissions []string) (*UserSession, error) {
	if userID == "" {
		return nil, fmt.Errorf("session_manager: userID is required")
	}
	if username == "" {
		return nil, fmt.Errorf("session_manager: username is required")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// Check session limit
	if len(m.sessions) >= m.maxSessions {
		return nil, fmt.Errorf("session_manager: maximum sessions (%d) reached", m.maxSessions)
	}

	// Check per-user session limit (max 10 per user)
	userSessionIDs := m.userSessions[userID]
	if len(userSessionIDs) >= 10 {
		return nil, fmt.Errorf("session_manager: maximum sessions per user (10) reached")
	}

	now := time.Now()
	session := &UserSession{
		ID:          generateSessionID(),
		UserID:      userID,
		Username:    username,
		Role:        role,
		CreatedAt:   now,
		ExpiresAt:   now.Add(m.sessionTTL),
		LastActive:  now,
		Permissions: permissions,
		Metadata:    make(map[string]string),
	}

	m.sessions[session.ID] = session
	m.userSessions[userID] = append(m.userSessions[userID], session.ID)

	return session, nil
}

// GetSession retrieves a session by ID.
func (m *SessionManager) GetSession(sessionID string) (*UserSession, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return nil, false
	}

	// Check expiry
	if time.Now().After(session.ExpiresAt) {
		return nil, false
	}

	return session, true
}

// GetUserSessions returns all active sessions for a user.
func (m *SessionManager) GetUserSessions(userID string) []*UserSession {
	m.mu.RLock()
	defer m.mu.RUnlock()

	sessionIDs := m.userSessions[userID]
	if len(sessionIDs) == 0 {
		return nil
	}

	now := time.Now()
	result := make([]*UserSession, 0, len(sessionIDs))
	for _, id := range sessionIDs {
		session, ok := m.sessions[id]
		if ok && !now.After(session.ExpiresAt) {
			result = append(result, session)
		}
	}

	return result
}

// TerminateSession terminates a single session by ID.
func (m *SessionManager) TerminateSession(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session_manager: session not found: %s", sessionID)
	}

	// Remove from user's session list
	userID := session.UserID
	userSessionIDs := m.userSessions[userID]
	for i, id := range userSessionIDs {
		if id == sessionID {
			m.userSessions[userID] = append(userSessionIDs[:i], userSessionIDs[i+1:]...)
			break
		}
	}
	if len(m.userSessions[userID]) == 0 {
		delete(m.userSessions, userID)
	}

	delete(m.sessions, sessionID)
	return nil
}

// TerminateUserSessions terminates all sessions for a user.
func (m *SessionManager) TerminateUserSessions(userID string) int {
	m.mu.Lock()
	defer m.mu.Unlock()

	sessionIDs := m.userSessions[userID]
	count := 0
	for _, id := range sessionIDs {
		delete(m.sessions, id)
		count++
	}
	delete(m.userSessions, userID)
	return count
}

// ValidateSession checks if a session ID is valid and not expired.
func (m *SessionManager) ValidateSession(sessionID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return false
	}

	return !time.Now().After(session.ExpiresAt)
}

// RefreshSession extends the session's expiry time and updates last active.
func (m *SessionManager) RefreshSession(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return fmt.Errorf("session_manager: session not found: %s", sessionID)
	}

	if time.Now().After(session.ExpiresAt) {
		return fmt.Errorf("session_manager: session expired: %s", sessionID)
	}

	session.LastActive = time.Now()
	session.ExpiresAt = time.Now().Add(m.sessionTTL)
	return nil
}

// ListActiveSessions returns all currently active (non-expired) sessions.
func (m *SessionManager) ListActiveSessions() []*UserSession {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now()
	result := make([]*UserSession, 0, len(m.sessions))
	for _, s := range m.sessions {
		if !now.After(s.ExpiresAt) {
			result = append(result, s)
		}
	}

	// Sort by creation time for determinism
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.Before(result[j].CreatedAt)
	})

	return result
}

// ActiveUserCount returns the number of unique users with active sessions.
func (m *SessionManager) ActiveUserCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()

	now := time.Now()
	activeUsers := make(map[string]bool)
	for _, s := range m.sessions {
		if !now.After(s.ExpiresAt) {
			activeUsers[s.UserID] = true
		}
	}
	return len(activeUsers)
}

// CleanupExpiredSessions removes all expired sessions and returns the count removed.
func (m *SessionManager) CleanupExpiredSessions() int {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now()
	removed := 0
	for id, session := range m.sessions {
		if now.After(session.ExpiresAt) {
			// Remove from user's session list
			userID := session.UserID
			userSessionIDs := m.userSessions[userID]
			for i, sid := range userSessionIDs {
				if sid == id {
					m.userSessions[userID] = append(userSessionIDs[:i], userSessionIDs[i+1:]...)
					break
				}
			}
			if len(m.userSessions[userID]) == 0 {
				delete(m.userSessions, userID)
			}

			delete(m.sessions, id)
			removed++
		}
	}
	return removed
}

// EnforceSessionLimit ensures the total session count does not exceed the limit.
// If over limit, it terminates the oldest sessions first.
func (m *SessionManager) EnforceSessionLimit() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.sessions) <= m.maxSessions {
		return nil
	}

	// Collect sessions sorted by creation time (oldest first)
	type sessionEntry struct {
		id        string
		createdAt time.Time
		userID    string
	}
	entries := make([]sessionEntry, 0, len(m.sessions))
	for id, s := range m.sessions {
		entries = append(entries, sessionEntry{id: id, createdAt: s.CreatedAt, userID: s.UserID})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].createdAt.Before(entries[j].createdAt)
	})

	// Remove oldest sessions until within limit
	excess := len(m.sessions) - m.maxSessions
	for i := 0; i < excess && i < len(entries); i++ {
		e := entries[i]

		// Remove from user's session list
		userSessionIDs := m.userSessions[e.userID]
		for j, sid := range userSessionIDs {
			if sid == e.id {
				m.userSessions[e.userID] = append(userSessionIDs[:j], userSessionIDs[j+1:]...)
				break
			}
		}
		if len(m.userSessions[e.userID]) == 0 {
			delete(m.userSessions, e.userID)
		}

		delete(m.sessions, e.id)
	}

	return nil
}

// TotalSessions returns the total number of sessions (including expired).
func (m *SessionManager) TotalSessions() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.sessions)
}

// HasPermission checks if a session has a specific permission.
func (m *SessionManager) HasPermission(sessionID string, permission string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	session, ok := m.sessions[sessionID]
	if !ok {
		return false
	}

	if time.Now().After(session.ExpiresAt) {
		return false
	}

	for _, p := range session.Permissions {
		if p == permission {
			return true
		}
	}
	return false
}