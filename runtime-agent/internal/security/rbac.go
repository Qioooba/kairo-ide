// Package security implements role-based access control (RBAC) for the
// Kairo IDE runtime agent. Roles are hierarchical: Admin > Auditor >
// Developer > Viewer. Each role maps to a set of permissions.
package security

import (
	"sync"
)

// Role represents a named role in the RBAC system.
type Role string

const (
	RoleAdmin     Role = "admin"
	RoleAuditor   Role = "auditor"
	RoleDeveloper Role = "developer"
	RoleViewer    Role = "viewer"
)

// Permission represents a fine-grained permission.
type Permission string

const (
	PermRead    Permission = "read"
	PermWrite   Permission = "write"
	PermExecute Permission = "execute"
	PermAdmin   Permission = "admin"
	PermAudit   Permission = "audit_read"
)

// roleHierarchy defines the ordering: higher index = more privileged.
var roleHierarchy = []Role{RoleViewer, RoleDeveloper, RoleAuditor, RoleAdmin}

// rolePermissions maps each role to its set of permissions.
var rolePermissions = map[Role]map[Permission]bool{
	RoleAdmin: {
		PermRead:    true,
		PermWrite:   true,
		PermExecute: true,
		PermAdmin:   true,
		PermAudit:   true,
	},
	RoleAuditor: {
		PermRead:  true,
		PermAudit: true,
	},
	RoleDeveloper: {
		PermRead:    true,
		PermWrite:   true,
		PermExecute: true,
	},
	RoleViewer: {
		PermRead: true,
	},
}

// RBACManager enforces role-based access control. It is safe for
// concurrent use.
type RBACManager struct {
	mu sync.RWMutex
}

// NewRBACManager creates a new RBACManager.
func NewRBACManager() *RBACManager {
	return &RBACManager{}
}

// CheckPermission returns true if the given role has the requested
// permission.
func (m *RBACManager) CheckPermission(role string, permission string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.checkPermissionUnlocked(Role(role), Permission(permission))
}

func (m *RBACManager) checkPermissionUnlocked(role Role, perm Permission) bool {
	perms, ok := rolePermissions[role]
	if !ok {
		return false
	}
	return perms[perm]
}

// GetRolePermissions returns the list of permissions assigned to the
// given role. Returns nil for unknown roles.
func (m *RBACManager) GetRolePermissions(role string) []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	perms, ok := rolePermissions[Role(role)]
	if !ok {
		return nil
	}
	out := make([]string, 0, len(perms))
	for p := range perms {
		out = append(out, string(p))
	}
	return out
}

// HasRole checks whether the user's role list contains the required
// role. Returns true if any of the user's roles matches exactly.
func (m *RBACManager) HasRole(userRoles []string, requiredRole string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, ur := range userRoles {
		if Role(ur) == Role(requiredRole) {
			return true
		}
	}
	return false
}

// IsHigherOrEqual returns true if userRole is at least as privileged
// as requiredRole according to the role hierarchy. Unknown roles
// are treated as the lowest level.
func (m *RBACManager) IsHigherOrEqual(userRole string, requiredRole string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	userIdx := m.roleIndex(Role(userRole))
	reqIdx := m.roleIndex(Role(requiredRole))
	return userIdx >= reqIdx
}

// roleIndex returns the position of a role in the hierarchy. Unknown
// roles return -1.
func (m *RBACManager) roleIndex(r Role) int {
	for i, candidate := range roleHierarchy {
		if candidate == r {
			return i
		}
	}
	return -1
}