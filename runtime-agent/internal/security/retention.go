// Package security implements data retention policy enforcement for the
// Kairo IDE runtime agent. It provides a configurable engine that scans
// directories and applies age-based and size-based retention rules.
// Predefined policies are provided for common resource types: logs,
// artifacts, backups, and sessions.
package security

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// RetentionPolicy defines a single retention rule for a resource type.
type RetentionPolicy struct {
	Name             string
	MaxAge           time.Duration
	MaxSize          int64 // 0 = no size limit
	ResourceType     string
	AutoCleanup      bool
	ArchiveBeforeDelete bool
}

// RetentionManager manages a set of retention policies and applies them
// to directories. It is safe for concurrent use.
type RetentionManager struct {
	mu       sync.RWMutex
	policies []RetentionPolicy
}

// PredefinedRetentionPolicies returns the default set of retention
// policies for logs, artifacts, backups, and sessions.
func PredefinedRetentionPolicies() []RetentionPolicy {
	return []RetentionPolicy{
		{
			Name:             "logs-retention",
			MaxAge:           30 * 24 * time.Hour, // 30 days
			MaxSize:          500 * 1024 * 1024,   // 500 MB
			ResourceType:     "logs",
			AutoCleanup:      true,
			ArchiveBeforeDelete: false,
		},
		{
			Name:             "artifacts-retention",
			MaxAge:           90 * 24 * time.Hour, // 90 days
			MaxSize:          2 * 1024 * 1024 * 1024, // 2 GB
			ResourceType:     "artifacts",
			AutoCleanup:      true,
			ArchiveBeforeDelete: true,
		},
		{
			Name:             "backups-retention",
			MaxAge:           60 * 24 * time.Hour, // 60 days
			MaxSize:          5 * 1024 * 1024 * 1024, // 5 GB
			ResourceType:     "backups",
			AutoCleanup:      false,
			ArchiveBeforeDelete: true,
		},
		{
			Name:             "sessions-retention",
			MaxAge:           7 * 24 * time.Hour, // 7 days
			MaxSize:          100 * 1024 * 1024,  // 100 MB
			ResourceType:     "sessions",
			AutoCleanup:      true,
			ArchiveBeforeDelete: false,
		},
	}
}

// NewRetentionManager creates a new RetentionManager with the given
// policies.
func NewRetentionManager(policies []RetentionPolicy) *RetentionManager {
	if policies == nil {
		policies = PredefinedRetentionPolicies()
	}
	return &RetentionManager{policies: policies}
}

// ShouldRetain returns true if the given resource should be retained
// based on its age and size against the policy for its resource type.
// If no policy matches, the resource is retained (conservative default).
func (m *RetentionManager) ShouldRetain(resourceType string, age time.Duration, size int64) bool {
	policy := m.GetRetentionPolicy(resourceType)
	if policy == nil {
		return true // No policy = retain everything
	}

	if policy.MaxAge > 0 && age > policy.MaxAge {
		return false
	}
	if policy.MaxSize > 0 && size > policy.MaxSize {
		return false
	}
	return true
}

// GetRetentionPolicy returns the retention policy for the given
// resource type, or nil if none exists.
func (m *RetentionManager) GetRetentionPolicy(resourceType string) *RetentionPolicy {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for i := range m.policies {
		if m.policies[i].ResourceType == resourceType {
			return &m.policies[i]
		}
	}
	return nil
}

// ApplyRetention scans the target directory and applies retention
// policies to files based on their modification time and size. Returns
// the number of deleted files, archived files, and any error.
func (m *RetentionManager) ApplyRetention(targetDir string) (deleted int, archived int, err error) {
	m.mu.RLock()
	policies := make([]RetentionPolicy, len(m.policies))
	copy(policies, m.policies)
	m.mu.RUnlock()

	entries, err := os.ReadDir(targetDir)
	if err != nil {
		return 0, 0, fmt.Errorf("read directory %s: %w", targetDir, err)
	}

	now := time.Now()

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filePath := filepath.Join(targetDir, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}

		resourceType := classifyResourceType(entry.Name(), targetDir)
		policy := m.matchPolicy(policies, resourceType)
		if policy == nil {
			continue
		}

		age := now.Sub(info.ModTime())
		shouldDelete := false

		if policy.MaxAge > 0 && age > policy.MaxAge {
			shouldDelete = true
		}
		if policy.MaxSize > 0 && info.Size() > policy.MaxSize {
			shouldDelete = true
		}

		if !shouldDelete {
			continue
		}

		if policy.AutoCleanup {
			if policy.ArchiveBeforeDelete {
				archiveDir := filepath.Join(targetDir, "archive")
				if archiveErr := archiveFile(filePath, archiveDir); archiveErr != nil {
					// Archive failed, still try to delete
					os.Remove(filePath)
					deleted++
				} else {
					archived++
					os.Remove(filePath)
				}
			} else {
				if err := os.Remove(filePath); err == nil {
					deleted++
				}
			}
		}
	}

	return deleted, archived, nil
}

// ListPolicies returns a copy of all retention policies.
func (m *RetentionManager) ListPolicies() []RetentionPolicy {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]RetentionPolicy, len(m.policies))
	copy(out, m.policies)
	return out
}

// matchPolicy finds the policy matching a resource type.
func (m *RetentionManager) matchPolicy(policies []RetentionPolicy, resourceType string) *RetentionPolicy {
	for i := range policies {
		if policies[i].ResourceType == resourceType {
			return &policies[i]
		}
	}
	return nil
}

// classifyResourceType determines the resource type from the file name
// and directory path.
func classifyResourceType(name, dir string) string {
	lower := strings.ToLower(name)
	base := strings.ToLower(filepath.Base(dir))

	switch {
	case strings.HasSuffix(lower, ".log"):
		return "logs"
	case strings.HasSuffix(lower, ".gz") || strings.HasSuffix(lower, ".tar") ||
		strings.HasSuffix(lower, ".zip") || strings.HasSuffix(lower, ".backup"):
		return "backups"
	case strings.HasSuffix(lower, ".war") || strings.HasSuffix(lower, ".jar") ||
		strings.HasSuffix(lower, ".ear") || base == "artifacts":
		return "artifacts"
	case strings.HasSuffix(lower, ".session") || base == "sessions":
		return "sessions"
	default:
		return ""
	}
}

// archiveFile copies a file to the archive directory.
func archiveFile(src, archiveDir string) error {
	if err := os.MkdirAll(archiveDir, 0o755); err != nil {
		return err
	}

	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}

	ts := time.Now().UTC().Format("20060102T150405")
	base := filepath.Base(src)
	dst := filepath.Join(archiveDir, base+"."+ts)

	return os.WriteFile(dst, data, 0o600)
}

// ApplyRetentionByType applies retention policies to files of a
// specific resource type within a directory. Returns deleted count,
// archived count, and any error.
func (m *RetentionManager) ApplyRetentionByType(targetDir string, resourceType string) (deleted int, archived int, err error) {
	m.mu.RLock()
	policies := make([]RetentionPolicy, len(m.policies))
	copy(policies, m.policies)
	m.mu.RUnlock()

	policy := m.matchPolicy(policies, resourceType)
	if policy == nil {
		return 0, 0, errors.New("no policy found for resource type: " + resourceType)
	}

	entries, err := os.ReadDir(targetDir)
	if err != nil {
		return 0, 0, fmt.Errorf("read directory %s: %w", targetDir, err)
	}

	now := time.Now()

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		rt := classifyResourceType(entry.Name(), targetDir)
		if rt != resourceType {
			continue
		}

		filePath := filepath.Join(targetDir, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}

		age := now.Sub(info.ModTime())
		shouldDelete := false

		if policy.MaxAge > 0 && age > policy.MaxAge {
			shouldDelete = true
		}
		if policy.MaxSize > 0 && info.Size() > policy.MaxSize {
			shouldDelete = true
		}

		if !shouldDelete {
			continue
		}

		if policy.AutoCleanup {
			if policy.ArchiveBeforeDelete {
				archiveDir := filepath.Join(targetDir, "archive")
				if archiveErr := archiveFile(filePath, archiveDir); archiveErr != nil {
					os.Remove(filePath)
					deleted++
				} else {
					archived++
					os.Remove(filePath)
				}
			} else {
				if err := os.Remove(filePath); err == nil {
					deleted++
				}
			}
		}
	}

	return deleted, archived, nil
}

// SortPoliciesByAge sorts policies in-place by MaxAge ascending.
func SortPoliciesByAge(policies []RetentionPolicy) {
	sort.Slice(policies, func(i, j int) bool {
		return policies[i].MaxAge < policies[j].MaxAge
	})
}

// SortPoliciesBySize sorts policies in-place by MaxSize ascending.
func SortPoliciesBySize(policies []RetentionPolicy) {
	sort.Slice(policies, func(i, j int) bool {
		return policies[i].MaxSize < policies[j].MaxSize
	})
}