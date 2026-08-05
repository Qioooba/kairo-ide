//go:build unwired

package security

import (
	"testing"
)

// ---- Admin role tests ----

func TestRBAC_Admin_AllPermissions(t *testing.T) {
	m := NewRBACManager()
	perms := []string{"read", "write", "execute", "admin", "audit_read"}
	for _, p := range perms {
		if !m.CheckPermission("admin", p) {
			t.Errorf("admin should have permission %s", p)
		}
	}
}

func TestRBAC_Admin_GetPermissions(t *testing.T) {
	m := NewRBACManager()
	got := m.GetRolePermissions("admin")
	if len(got) != 5 {
		t.Errorf("admin should have 5 permissions, got %d: %v", len(got), got)
	}
}

// ---- Auditor role tests ----

func TestRBAC_Auditor_HasReadAndAudit(t *testing.T) {
	m := NewRBACManager()
	if !m.CheckPermission("auditor", "read") {
		t.Error("auditor should have read permission")
	}
	if !m.CheckPermission("auditor", "audit_read") {
		t.Error("auditor should have audit_read permission")
	}
}

func TestRBAC_Auditor_NoWrite(t *testing.T) {
	m := NewRBACManager()
	if m.CheckPermission("auditor", "write") {
		t.Error("auditor should NOT have write permission")
	}
}

func TestRBAC_Auditor_NoExecute(t *testing.T) {
	m := NewRBACManager()
	if m.CheckPermission("auditor", "execute") {
		t.Error("auditor should NOT have execute permission")
	}
}

func TestRBAC_Auditor_NoAdmin(t *testing.T) {
	m := NewRBACManager()
	if m.CheckPermission("auditor", "admin") {
		t.Error("auditor should NOT have admin permission")
	}
}

// ---- Developer role tests ----

func TestRBAC_Developer_HasReadWriteExecute(t *testing.T) {
	m := NewRBACManager()
	if !m.CheckPermission("developer", "read") {
		t.Error("developer should have read permission")
	}
	if !m.CheckPermission("developer", "write") {
		t.Error("developer should have write permission")
	}
	if !m.CheckPermission("developer", "execute") {
		t.Error("developer should have execute permission")
	}
}

func TestRBAC_Developer_NoAdmin(t *testing.T) {
	m := NewRBACManager()
	if m.CheckPermission("developer", "admin") {
		t.Error("developer should NOT have admin permission")
	}
}

func TestRBAC_Developer_NoAudit(t *testing.T) {
	m := NewRBACManager()
	if m.CheckPermission("developer", "audit_read") {
		t.Error("developer should NOT have audit_read permission")
	}
}

// ---- Viewer role tests ----

func TestRBAC_Viewer_OnlyRead(t *testing.T) {
	m := NewRBACManager()
	if !m.CheckPermission("viewer", "read") {
		t.Error("viewer should have read permission")
	}
	if m.CheckPermission("viewer", "write") {
		t.Error("viewer should NOT have write permission")
	}
	if m.CheckPermission("viewer", "execute") {
		t.Error("viewer should NOT have execute permission")
	}
	if m.CheckPermission("viewer", "admin") {
		t.Error("viewer should NOT have admin permission")
	}
	if m.CheckPermission("viewer", "audit_read") {
		t.Error("viewer should NOT have audit_read permission")
	}
}

func TestRBAC_Viewer_GetPermissions(t *testing.T) {
	m := NewRBACManager()
	got := m.GetRolePermissions("viewer")
	if len(got) != 1 {
		t.Errorf("viewer should have 1 permission, got %d: %v", len(got), got)
	}
	if len(got) > 0 && got[0] != "read" {
		t.Errorf("viewer permission should be 'read', got %q", got[0])
	}
}

// ---- Unknown role tests ----

func TestRBAC_UnknownRole_NoPermissions(t *testing.T) {
	m := NewRBACManager()
	if m.CheckPermission("unknown", "read") {
		t.Error("unknown role should NOT have any permission")
	}
	if m.CheckPermission("unknown", "write") {
		t.Error("unknown role should NOT have any permission")
	}
}

func TestRBAC_UnknownRole_GetPermissionsNil(t *testing.T) {
	m := NewRBACManager()
	got := m.GetRolePermissions("unknown")
	if got != nil {
		t.Errorf("unknown role should return nil, got %v", got)
	}
}

func TestRBAC_EmptyRole_NoPermissions(t *testing.T) {
	m := NewRBACManager()
	if m.CheckPermission("", "read") {
		t.Error("empty role should NOT have any permission")
	}
}

// ---- Role hierarchy tests ----

func TestRBAC_Hierarchy_AdminIsHigherThanAll(t *testing.T) {
	m := NewRBACManager()
	if !m.IsHigherOrEqual("admin", "admin") {
		t.Error("admin should be >= admin")
	}
	if !m.IsHigherOrEqual("admin", "auditor") {
		t.Error("admin should be >= auditor")
	}
	if !m.IsHigherOrEqual("admin", "developer") {
		t.Error("admin should be >= developer")
	}
	if !m.IsHigherOrEqual("admin", "viewer") {
		t.Error("admin should be >= viewer")
	}
}

func TestRBAC_Hierarchy_AuditorPosition(t *testing.T) {
	m := NewRBACManager()
	if m.IsHigherOrEqual("auditor", "admin") {
		t.Error("auditor should NOT be >= admin")
	}
	if !m.IsHigherOrEqual("auditor", "auditor") {
		t.Error("auditor should be >= auditor")
	}
	if !m.IsHigherOrEqual("auditor", "developer") {
		t.Error("auditor should be >= developer")
	}
	if !m.IsHigherOrEqual("auditor", "viewer") {
		t.Error("auditor should be >= viewer")
	}
}

func TestRBAC_Hierarchy_DeveloperPosition(t *testing.T) {
	m := NewRBACManager()
	if m.IsHigherOrEqual("developer", "admin") {
		t.Error("developer should NOT be >= admin")
	}
	if m.IsHigherOrEqual("developer", "auditor") {
		t.Error("developer should NOT be >= auditor")
	}
	if !m.IsHigherOrEqual("developer", "developer") {
		t.Error("developer should be >= developer")
	}
	if !m.IsHigherOrEqual("developer", "viewer") {
		t.Error("developer should be >= viewer")
	}
}

func TestRBAC_Hierarchy_ViewerIsLowest(t *testing.T) {
	m := NewRBACManager()
	if m.IsHigherOrEqual("viewer", "admin") {
		t.Error("viewer should NOT be >= admin")
	}
	if m.IsHigherOrEqual("viewer", "auditor") {
		t.Error("viewer should NOT be >= auditor")
	}
	if m.IsHigherOrEqual("viewer", "developer") {
		t.Error("viewer should NOT be >= developer")
	}
	if !m.IsHigherOrEqual("viewer", "viewer") {
		t.Error("viewer should be >= viewer")
	}
}

func TestRBAC_Hierarchy_UnknownRole(t *testing.T) {
	m := NewRBACManager()
	// Unknown role index is -1, so it should NOT be >= any known role
	if m.IsHigherOrEqual("unknown", "viewer") {
		t.Error("unknown role should NOT be >= viewer")
	}
	if m.IsHigherOrEqual("unknown", "admin") {
		t.Error("unknown role should NOT be >= admin")
	}
	// Known role >= unknown: unknown index is -1, known >= -1 is true
	if !m.IsHigherOrEqual("admin", "unknown") {
		t.Error("admin should be >= unknown role")
	}
}

// ---- HasRole tests ----

func TestRBAC_HasRole_ExactMatch(t *testing.T) {
	m := NewRBACManager()
	if !m.HasRole([]string{"admin", "developer"}, "admin") {
		t.Error("should find admin in role list")
	}
}

func TestRBAC_HasRole_NotFound(t *testing.T) {
	m := NewRBACManager()
	if m.HasRole([]string{"developer", "viewer"}, "admin") {
		t.Error("should NOT find admin in role list")
	}
}

func TestRBAC_HasRole_EmptyList(t *testing.T) {
	m := NewRBACManager()
	if m.HasRole([]string{}, "admin") {
		t.Error("should NOT find role in empty list")
	}
}

func TestRBAC_HasRole_NilList(t *testing.T) {
	m := NewRBACManager()
	if m.HasRole(nil, "admin") {
		t.Error("should NOT find role in nil list")
	}
}

func TestRBAC_HasRole_MultipleRoles(t *testing.T) {
	m := NewRBACManager()
	roles := []string{"admin", "auditor", "developer", "viewer"}
	for _, r := range roles {
		if !m.HasRole(roles, r) {
			t.Errorf("should find %s in role list", r)
		}
	}
}

// ---- GetRolePermissions for all roles ----

func TestRBAC_GetRolePermissions_Developer(t *testing.T) {
	m := NewRBACManager()
	got := m.GetRolePermissions("developer")
	if len(got) != 3 {
		t.Errorf("developer should have 3 permissions, got %d: %v", len(got), got)
	}
}

func TestRBAC_GetRolePermissions_Auditor(t *testing.T) {
	m := NewRBACManager()
	got := m.GetRolePermissions("auditor")
	if len(got) != 2 {
		t.Errorf("auditor should have 2 permissions, got %d: %v", len(got), got)
	}
}

// ---- Edge case tests ----

func TestRBAC_CheckPermission_UnknownPermission(t *testing.T) {
	m := NewRBACManager()
	if m.CheckPermission("admin", "nonexistent") {
		t.Error("admin should NOT have nonexistent permission")
	}
}

func TestRBAC_ConcurrentAccess(t *testing.T) {
	m := NewRBACManager()
	done := make(chan bool, 20)
	for i := 0; i < 10; i++ {
		go func() {
			for j := 0; j < 100; j++ {
				m.CheckPermission("admin", "read")
				m.GetRolePermissions("developer")
				m.IsHigherOrEqual("admin", "viewer")
				m.HasRole([]string{"admin"}, "admin")
			}
			done <- true
		}()
		go func() {
			for j := 0; j < 100; j++ {
				m.CheckPermission("viewer", "read")
				m.GetRolePermissions("auditor")
				m.IsHigherOrEqual("developer", "viewer")
				m.HasRole([]string{"viewer", "developer"}, "developer")
			}
			done <- true
		}()
	}
	for i := 0; i < 20; i++ {
		<-done
	}
}