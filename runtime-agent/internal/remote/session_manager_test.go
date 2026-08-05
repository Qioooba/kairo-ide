//go:build remote

package remote

import (
	"testing"
	"time"
)

// TestNewSessionManager tests basic creation.
func TestNewSessionManager(t *testing.T) {
	sm := NewSessionManager(50, 1*time.Hour)
	if sm == nil {
		t.Fatal("NewSessionManager returned nil")
	}
	if sm.maxSessions != 50 {
		t.Errorf("maxSessions = %d, want 50", sm.maxSessions)
	}
	if sm.sessionTTL != 1*time.Hour {
		t.Errorf("sessionTTL = %v, want 1h", sm.sessionTTL)
	}
	if sm.sessions == nil {
		t.Error("sessions map is nil")
	}
	if sm.userSessions == nil {
		t.Error("userSessions map is nil")
	}
}

// TestNewSessionManager_Defaults tests default values when zero/negative.
func TestNewSessionManager_Defaults(t *testing.T) {
	sm := NewSessionManager(0, 0)
	if sm.maxSessions != 100 {
		t.Errorf("maxSessions = %d, want 100", sm.maxSessions)
	}
	if sm.sessionTTL != 8*time.Hour {
		t.Errorf("sessionTTL = %v, want 8h", sm.sessionTTL)
	}
}

// TestCreateSession tests session creation.
func TestCreateSession(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	session, err := sm.CreateSession("user-1", "alice", "admin", []string{"read", "write"})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if session == nil {
		t.Fatal("session is nil")
	}
	if session.UserID != "user-1" {
		t.Errorf("UserID = %q, want user-1", session.UserID)
	}
	if session.Username != "alice" {
		t.Errorf("Username = %q, want alice", session.Username)
	}
	if session.Role != "admin" {
		t.Errorf("Role = %q, want admin", session.Role)
	}
	if session.ID == "" {
		t.Error("session ID is empty")
	}
	if session.ExpiresAt.Before(time.Now()) {
		t.Error("expiry should be in the future")
	}
	if len(session.Permissions) != 2 {
		t.Errorf("permissions = %d, want 2", len(session.Permissions))
	}
	if session.Metadata == nil {
		t.Error("metadata map is nil")
	}
}

// TestCreateSession_EmptyUserID tests validation.
func TestCreateSession_EmptyUserID(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	_, err := sm.CreateSession("", "alice", "admin", nil)
	if err == nil {
		t.Fatal("expected error for empty userID, got nil")
	}
}

// TestCreateSession_EmptyUsername tests validation.
func TestCreateSession_EmptyUsername(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	_, err := sm.CreateSession("user-1", "", "admin", nil)
	if err == nil {
		t.Fatal("expected error for empty username, got nil")
	}
}

// TestCreateSession_MaxLimit tests that session limit is enforced.
func TestCreateSession_MaxLimit(t *testing.T) {
	sm := NewSessionManager(2, 1*time.Hour)

	// Create 2 sessions (max limit)
	_, err := sm.CreateSession("user-1", "alice", "user", nil)
	if err != nil {
		t.Fatalf("CreateSession 1: %v", err)
	}
	_, err = sm.CreateSession("user-2", "bob", "user", nil)
	if err != nil {
		t.Fatalf("CreateSession 2: %v", err)
	}

	// Third should fail
	_, err = sm.CreateSession("user-3", "charlie", "user", nil)
	if err == nil {
		t.Fatal("expected error when max sessions reached, got nil")
	}
}

// TestSessionManager_GetSession tests retrieving a session.
func TestSessionManager_GetSession(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	session, _ := sm.CreateSession("user-1", "alice", "admin", nil)
	retrieved, ok := sm.GetSession(session.ID)
	if !ok {
		t.Fatal("session not found")
	}
	if retrieved.ID != session.ID {
		t.Errorf("ID = %q, want %q", retrieved.ID, session.ID)
	}
	if retrieved.Username != "alice" {
		t.Errorf("Username = %q, want alice", retrieved.Username)
	}
}

// TestGetSession_NotFound tests retrieving a nonexistent session.
func TestGetSession_NotFound(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	_, ok := sm.GetSession("nonexistent-id")
	if ok {
		t.Fatal("expected false for nonexistent session")
	}
}

// TestGetSession_Expired tests that expired sessions are not returned.
func TestGetSession_Expired(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Millisecond)

	session, _ := sm.CreateSession("user-1", "alice", "user", nil)
	time.Sleep(10 * time.Millisecond)

	_, ok := sm.GetSession(session.ID)
	if ok {
		t.Fatal("expected session to be expired")
	}
}

// TestGetUserSessions tests retrieving all sessions for a user.
func TestGetUserSessions(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-2", "bob", "user", nil)

	sessions := sm.GetUserSessions("user-1")
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions for user-1, got %d", len(sessions))
	}

	sessions = sm.GetUserSessions("user-2")
	if len(sessions) != 1 {
		t.Errorf("expected 1 session for user-2, got %d", len(sessions))
	}
}

// TestGetUserSessions_Nonexistent tests sessions for a user with no sessions.
func TestGetUserSessions_Nonexistent(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	sessions := sm.GetUserSessions("nonexistent")
	if sessions != nil {
		t.Errorf("expected nil, got %v", sessions)
	}
}

// TestTerminateSession tests terminating a single session.
func TestTerminateSession(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	session, _ := sm.CreateSession("user-1", "alice", "user", nil)
	err := sm.TerminateSession(session.ID)
	if err != nil {
		t.Fatalf("TerminateSession: %v", err)
	}

	_, ok := sm.GetSession(session.ID)
	if ok {
		t.Fatal("session should be terminated")
	}

	// User sessions should be empty
	if sm.GetUserSessions("user-1") != nil {
		t.Error("user sessions should be nil after termination")
	}
}

// TestTerminateSession_NotFound tests terminating a nonexistent session.
func TestTerminateSession_NotFound(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	err := sm.TerminateSession("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent session")
	}
}

// TestTerminateUserSessions tests terminating all sessions for a user.
func TestTerminateUserSessions(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-2", "bob", "user", nil)

	count := sm.TerminateUserSessions("user-1")
	if count != 2 {
		t.Errorf("terminated = %d, want 2", count)
	}

	if sm.GetUserSessions("user-1") != nil {
		t.Error("user-1 sessions should be nil")
	}

	// user-2 should still have sessions
	if len(sm.GetUserSessions("user-2")) != 1 {
		t.Error("user-2 should still have 1 session")
	}
}

// TestValidateSession tests session validation.
func TestValidateSession(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	session, _ := sm.CreateSession("user-1", "alice", "user", nil)
	if !sm.ValidateSession(session.ID) {
		t.Fatal("session should be valid")
	}
}

// TestValidateSession_Invalid tests validation of invalid session.
func TestValidateSession_Invalid(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	if sm.ValidateSession("nonexistent") {
		t.Fatal("nonexistent session should not be valid")
	}
}

// TestSessionManager_ValidateSession_Expired tests validation of expired session.
func TestSessionManager_ValidateSession_Expired(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Millisecond)

	session, _ := sm.CreateSession("user-1", "alice", "user", nil)
	time.Sleep(10 * time.Millisecond)

	if sm.ValidateSession(session.ID) {
		t.Fatal("expired session should not be valid")
	}
}

// TestRefreshSession tests refreshing a session's expiry.
func TestRefreshSession(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	session, _ := sm.CreateSession("user-1", "alice", "user", nil)
	originalExpiry := session.ExpiresAt
	originalLastActive := session.LastActive

	time.Sleep(10 * time.Millisecond)

	err := sm.RefreshSession(session.ID)
	if err != nil {
		t.Fatalf("RefreshSession: %v", err)
	}

	refreshed, _ := sm.GetSession(session.ID)
	if !refreshed.ExpiresAt.After(originalExpiry) {
		t.Error("expiry should be extended after refresh")
	}
	if !refreshed.LastActive.After(originalLastActive) {
		t.Error("lastActive should be updated after refresh")
	}
}

// TestRefreshSession_NotFound tests refreshing nonexistent session.
func TestRefreshSession_NotFound(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	err := sm.RefreshSession("nonexistent")
	if err == nil {
		t.Fatal("expected error for nonexistent session")
	}
}

// TestRefreshSession_Expired tests refreshing an expired session.
func TestRefreshSession_Expired(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Millisecond)

	session, _ := sm.CreateSession("user-1", "alice", "user", nil)
	time.Sleep(10 * time.Millisecond)

	err := sm.RefreshSession(session.ID)
	if err == nil {
		t.Fatal("expected error when refreshing expired session")
	}
}

// TestListActiveSessions tests listing active sessions.
func TestListActiveSessions(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-2", "bob", "user", nil)

	active := sm.ListActiveSessions()
	if len(active) != 2 {
		t.Errorf("expected 2 active sessions, got %d", len(active))
	}
}

// TestListActiveSessions_Expired tests that expired sessions are excluded.
func TestListActiveSessions_Expired(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Millisecond)

	sm.CreateSession("user-1", "alice", "user", nil)
	time.Sleep(10 * time.Millisecond)

	active := sm.ListActiveSessions()
	if len(active) != 0 {
		t.Errorf("expected 0 active sessions, got %d", len(active))
	}
}

// TestActiveUserCount tests counting unique active users.
func TestActiveUserCount(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-1", "alice", "user", nil) // same user, multiple sessions
	sm.CreateSession("user-2", "bob", "user", nil)

	count := sm.ActiveUserCount()
	if count != 2 {
		t.Errorf("active user count = %d, want 2", count)
	}
}

// TestSessionManager_CleanupExpiredSessions tests cleaning up expired sessions.
func TestSessionManager_CleanupExpiredSessions(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Millisecond)

	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-2", "bob", "user", nil)
	time.Sleep(10 * time.Millisecond)

	removed := sm.CleanupExpiredSessions()
	if removed != 2 {
		t.Errorf("removed = %d, want 2", removed)
	}

	if sm.TotalSessions() != 0 {
		t.Errorf("total sessions = %d, want 0", sm.TotalSessions())
	}
}

// TestEnforceSessionLimit tests session limit enforcement.
func TestEnforceSessionLimit(t *testing.T) {
	sm := NewSessionManager(2, 1*time.Hour)

	// Create sessions up to the limit by directly inserting
	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-2", "bob", "user", nil)

	// Bypass the limit check by directly inserting
	sm.mu.Lock()
	sm.sessions["extra-1"] = &UserSession{
		ID:        "extra-1",
		UserID:    "user-3",
		Username:  "charlie",
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}
	sm.sessions["extra-2"] = &UserSession{
		ID:        "extra-2",
		UserID:    "user-4",
		Username:  "dave",
		CreatedAt: time.Now().Add(-1 * time.Hour),
		ExpiresAt: time.Now().Add(1 * time.Hour),
	}
	sm.userSessions["user-3"] = []string{"extra-1"}
	sm.userSessions["user-4"] = []string{"extra-2"}
	sm.mu.Unlock()

	err := sm.EnforceSessionLimit()
	if err != nil {
		t.Fatalf("EnforceSessionLimit: %v", err)
	}

	if sm.TotalSessions() > 2 {
		t.Errorf("total sessions = %d, should be <= 2", sm.TotalSessions())
	}
}

// TestEnforceSessionLimit_WithinLimit tests enforcement when within limit.
func TestEnforceSessionLimit_WithinLimit(t *testing.T) {
	sm := NewSessionManager(10, 1*time.Hour)

	sm.CreateSession("user-1", "alice", "user", nil)
	err := sm.EnforceSessionLimit()
	if err != nil {
		t.Fatalf("EnforceSessionLimit: %v", err)
	}
	if sm.TotalSessions() != 1 {
		t.Errorf("sessions should remain at 1, got %d", sm.TotalSessions())
	}
}

// TestTotalSessions tests total session count.
func TestTotalSessions(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	if sm.TotalSessions() != 0 {
		t.Errorf("initial total = %d, want 0", sm.TotalSessions())
	}

	sm.CreateSession("user-1", "alice", "user", nil)
	sm.CreateSession("user-2", "bob", "user", nil)

	if sm.TotalSessions() != 2 {
		t.Errorf("total = %d, want 2", sm.TotalSessions())
	}
}

// TestHasPermission tests permission checking.
func TestHasPermission(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	session, _ := sm.CreateSession("user-1", "alice", "admin", []string{"read", "write", "admin"})

	if !sm.HasPermission(session.ID, "read") {
		t.Error("should have read permission")
	}
	if !sm.HasPermission(session.ID, "write") {
		t.Error("should have write permission")
	}
	if !sm.HasPermission(session.ID, "admin") {
		t.Error("should have admin permission")
	}
	if sm.HasPermission(session.ID, "delete") {
		t.Error("should not have delete permission")
	}
}

// TestHasPermission_NotFound tests permission check for nonexistent session.
func TestHasPermission_NotFound(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	if sm.HasPermission("nonexistent", "read") {
		t.Fatal("nonexistent session should not have permissions")
	}
}

// TestHasPermission_Expired tests permission check for expired session.
func TestHasPermission_Expired(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Millisecond)

	session, _ := sm.CreateSession("user-1", "alice", "user", []string{"read"})
	time.Sleep(10 * time.Millisecond)

	if sm.HasPermission(session.ID, "read") {
		t.Fatal("expired session should not have permissions")
	}
}

// TestUserSession_Fields tests UserSession struct fields.
func TestUserSession_Fields(t *testing.T) {
	now := time.Now()
	session := UserSession{
		ID:          "session-1",
		UserID:      "user-1",
		Username:    "alice",
		Role:        "admin",
		CreatedAt:   now,
		ExpiresAt:   now.Add(1 * time.Hour),
		LastActive:  now,
		Permissions: []string{"read", "write"},
		Metadata:    map[string]string{"ip": "127.0.0.1"},
	}

	if session.ID != "session-1" {
		t.Errorf("ID = %q", session.ID)
	}
	if session.UserID != "user-1" {
		t.Errorf("UserID = %q", session.UserID)
	}
	if session.Username != "alice" {
		t.Errorf("Username = %q", session.Username)
	}
	if session.Role != "admin" {
		t.Errorf("Role = %q", session.Role)
	}
	if session.Metadata["ip"] != "127.0.0.1" {
		t.Errorf("Metadata ip = %q", session.Metadata["ip"])
	}
}

// TestSessionTTL_Expiry tests that sessions expire at the correct time.
func TestSessionTTL_Expiry(t *testing.T) {
	ttl := 100 * time.Millisecond
	sm := NewSessionManager(100, ttl)

	session, _ := sm.CreateSession("user-1", "alice", "user", nil)
	expectedExpiry := session.CreatedAt.Add(ttl)

	if session.ExpiresAt.Sub(expectedExpiry) > time.Millisecond {
		t.Errorf("expiry mismatch: got %v, want ~%v", session.ExpiresAt, expectedExpiry)
	}
}

// TestCreateSession_MultipleSameUser tests multiple sessions for same user.
func TestCreateSession_MultipleSameUser(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	s1, _ := sm.CreateSession("user-1", "alice", "user", nil)
	s2, _ := sm.CreateSession("user-1", "alice", "user", nil)

	if s1.ID == s2.ID {
		t.Error("sessions should have different IDs")
	}

	sessions := sm.GetUserSessions("user-1")
	if len(sessions) != 2 {
		t.Errorf("expected 2 sessions, got %d", len(sessions))
	}
}

// TestCleanupExpiredSessions_NoExpired tests cleanup when no sessions are expired.
func TestCleanupExpiredSessions_NoExpired(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	sm.CreateSession("user-1", "alice", "user", nil)
	removed := sm.CleanupExpiredSessions()
	if removed != 0 {
		t.Errorf("removed = %d, want 0", removed)
	}
}

// TestTerminateUserSessions_Nonexistent tests terminating a user with no sessions.
func TestTerminateUserSessions_Nonexistent(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)
	count := sm.TerminateUserSessions("nonexistent")
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
}

// TestListActiveSessions_Ordering tests that sessions are sorted by creation time.
func TestListActiveSessions_Ordering(t *testing.T) {
	sm := NewSessionManager(100, 1*time.Hour)

	s1, _ := sm.CreateSession("user-1", "alice", "user", nil)
	time.Sleep(1 * time.Millisecond)
	s2, _ := sm.CreateSession("user-2", "bob", "user", nil)
	time.Sleep(1 * time.Millisecond)
	s3, _ := sm.CreateSession("user-3", "charlie", "user", nil)

	active := sm.ListActiveSessions()
	if len(active) != 3 {
		t.Fatalf("expected 3 sessions, got %d", len(active))
	}

	if active[0].ID != s1.ID {
		t.Error("first session should be oldest")
	}
	if active[1].ID != s2.ID {
		t.Error("middle session should be second")
	}
	if active[2].ID != s3.ID {
		t.Error("last session should be newest")
	}
}

// TestSessionID_Uniqueness tests that session IDs are unique.
func TestSessionID_Uniqueness(t *testing.T) {
	ids := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := generateSessionID()
		if ids[id] {
			t.Fatal("duplicate session ID generated")
		}
		ids[id] = true
	}
}