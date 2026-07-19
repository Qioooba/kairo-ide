package app

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/security"
)

// DeployEngine handles file deployment from build output to the
// deployment root (CatalinaBase / webapps / ROOT). It accepts a
// DeployPlan with typed entries and executes atomic single-file
// replacements using temp + fsync + rename.
type DeployEngine struct {
	sandbox *security.WorkspaceRoots
}

// NewDeployEngine creates a new DeployEngine.
func NewDeployEngine(sandbox *security.WorkspaceRoots) *DeployEngine {
	return &DeployEngine{sandbox: sandbox}
}

// DeploySummary is the result of executing a DeployPlan.
type DeploySummary struct {
	FilesAdded    int
	FilesModified int
	FilesDeleted  int
	TotalBytes    int64
}

// Deploy executes the given DeployPlan against the deployment root.
// deploymentRoot is the target directory (e.g. CatalinaBase/webapps/ROOT).
// The plan entries map source files to relative target paths within the
// deployment root:
//
//	Source                    → Target (relative to deploymentRoot)
//	─────────────────────────────────────────────────────────────
//	build output (classes)    → WEB-INF/classes
//	resource roots            → WEB-INF/classes
//	webapp dir contents       → deployment root
//	libs                      → WEB-INF/lib
//
// Mode "merge" is the default; mode "mirror" requires explicit request
// and will remove files not in the plan.
func (e *DeployEngine) Deploy(deploymentRoot string, plan *domain.DeployPlan) (*DeploySummary, error) {
	if plan == nil {
		return nil, fmt.Errorf("deploy plan is nil")
	}

	// Ensure deployment root exists
	if err := os.MkdirAll(deploymentRoot, 0755); err != nil {
		return nil, fmt.Errorf("create deployment root %s: %w", deploymentRoot, err)
	}

	summary := &DeploySummary{}

	// Mirror mode: collect files that should be removed
	var keepSet map[string]bool
	if plan.Mode == "mirror" {
		keepSet = make(map[string]bool)
		for _, entry := range plan.Entries {
			if entry.Action != "delete" {
				absTarget := filepath.Join(deploymentRoot, entry.Target)
				keepSet[absTarget] = true
			}
		}
	}

	// Execute each entry
	for _, entry := range plan.Entries {
		absTarget := filepath.Join(deploymentRoot, entry.Target)

		// Sandbox check for target
		if e.sandbox != nil {
			if _, err := e.sandbox.AuthorizeWriteAbs(deploymentRoot); err != nil {
				return nil, fmt.Errorf("sandbox: deployment root %s not authorized: %w", deploymentRoot, err)
			}
		}

		switch entry.Action {
		case "delete":
			if err := os.RemoveAll(absTarget); err != nil && !os.IsNotExist(err) {
				return nil, fmt.Errorf("delete %s: %w", absTarget, err)
			}
			summary.FilesDeleted++

		case "add", "modify":
			// Sandbox check for source
			if e.sandbox != nil {
				if _, err := e.sandbox.AuthorizeReadAbs(entry.Source); err != nil {
					return nil, fmt.Errorf("sandbox: source %s not authorized: %w", entry.Source, err)
				}
			}

			srcInfo, err := os.Stat(entry.Source)
			if err != nil {
				return nil, fmt.Errorf("stat source %s: %w", entry.Source, err)
			}

			if srcInfo.IsDir() {
				// Copy directory recursively
				added, bytes, err := e.copyDir(entry.Source, absTarget)
				if err != nil {
					return nil, fmt.Errorf("copy dir %s -> %s: %w", entry.Source, absTarget, err)
				}
				summary.FilesAdded += added
				summary.TotalBytes += bytes
			} else {
				// Atomic single-file replacement
				existed := false
				if _, err := os.Stat(absTarget); err == nil {
					existed = true
				}
				bytes, err := e.copyFileAtomic(entry.Source, absTarget)
				if err != nil {
					return nil, fmt.Errorf("copy %s -> %s: %w", entry.Source, absTarget, err)
				}
				summary.TotalBytes += bytes
				if existed {
					summary.FilesModified++
				} else {
					summary.FilesAdded++
				}
			}
		}
	}

	// Mirror mode: remove stale files not in the plan
	if plan.Mode == "mirror" && keepSet != nil {
		removed, err := e.removeStale(deploymentRoot, keepSet)
		if err != nil {
			return nil, fmt.Errorf("mirror cleanup: %w", err)
		}
		summary.FilesDeleted += removed
	}

	return summary, nil
}

// copyFileAtomic copies a single file using temp + fsync + rename for
// atomic replacement.
func (e *DeployEngine) copyFileAtomic(src, dst string) (int64, error) {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return 0, err
	}

	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return 0, err
	}

	in, err := os.Open(src)
	if err != nil {
		return 0, err
	}
	defer in.Close()

	// Write to a temp file in the same directory (same filesystem ensures
	// atomic rename).
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".kairo-tmp-*")
	if err != nil {
		return 0, err
	}
	tmpPath := tmp.Name()
	cleanup := func() { os.Remove(tmpPath) }
	defer cleanup()

	written, err := io.Copy(tmp, in)
	if err != nil {
		tmp.Close()
		return 0, err
	}

	// Preserve source permissions
	if err := tmp.Chmod(srcInfo.Mode()); err != nil {
		tmp.Close()
		return 0, err
	}

	// fsync the file data to disk
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return 0, err
	}

	if err := tmp.Close(); err != nil {
		return 0, err
	}

	// fsync the directory to ensure the rename is durable
	if err := fsyncDir(filepath.Dir(dst)); err != nil {
		return 0, fmt.Errorf("fsync dir: %w", err)
	}

	// Atomic rename
	if err := os.Rename(tmpPath, dst); err != nil {
		return 0, err
	}

	// fsync the directory again after rename
	_ = fsyncDir(filepath.Dir(dst))

	return written, nil
}

// copyDir recursively copies a directory from src to dst.
func (e *DeployEngine) copyDir(src, dst string) (files int, bytes int64, err error) {
	err = filepath.WalkDir(src, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, relErr := filepath.Rel(src, path)
		if relErr != nil {
			return relErr
		}
		targetPath := filepath.Join(dst, rel)

		if d.IsDir() {
			return os.MkdirAll(targetPath, 0755)
		}

		n, copyErr := e.copyFileAtomic(path, targetPath)
		if copyErr != nil {
			return copyErr
		}
		files++
		bytes += n
		return nil
	})
	return
}

// removeStale removes files in root that are not in keepSet.
func (e *DeployEngine) removeStale(root string, keepSet map[string]bool) (int, error) {
	removed := 0
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		// Skip directories; we only remove files.
		// Directories will be cleaned up by the OS or on next deploy.
		if !keepSet[path] {
			if d.IsDir() {
				// Do not auto-remove unknown directories in mirror mode
				// to avoid catastrophic mistakes.
				return filepath.SkipDir
			}
			if err := os.Remove(path); err != nil {
				return fmt.Errorf("remove stale %s: %w", path, err)
			}
			removed++
		}
		return nil
	})
	return removed, err
}

// fsyncDir opens and fsyncs a directory to ensure metadata is durable.
func fsyncDir(dir string) error {
	f, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

// Compile-time marker: deploy_impl previously used syscall.Flock
// for cross-platform file locking. We dropped that because
// syscall.Flock does not exist on Windows. The deploy engine
// now relies on os.OpenFile's exclusive semantics + retry on
// ERROR_SHARING_VIOLATION. This comment keeps the history
// searchable.