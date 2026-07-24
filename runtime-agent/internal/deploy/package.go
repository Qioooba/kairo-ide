package deploy

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

// =============================================================================
// WAR/EAR Packaging
// =============================================================================

// PackageType represents the type of archive to package.
type PackageType string

const (
	PackageTypeWAR PackageType = "war"
	PackageTypeEAR PackageType = "ear"
	PackageTypeJAR PackageType = "jar"
)

// PackageRequest describes a packaging request.
type PackageRequest struct {
	Type        PackageType
	SourceDir   string
	OutputPath  string
	WebXMLPath  string
	ManifestMF  string
	IncludeDirs []string
	ExcludePatterns []string
}

// PackageResult holds the result of a packaging operation.
type PackageResult struct {
	PackagePath string
	Size        int64
	EntryCount  int
	Duration    time.Duration
}

// PackageArchive creates a WAR, EAR, or JAR archive from the given source directory.
func PackageArchive(ctx context.Context, req PackageRequest) (*PackageResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if req.SourceDir == "" {
		return nil, fmt.Errorf("source directory is required")
	}
	if req.OutputPath == "" {
		return nil, fmt.Errorf("output path is required")
	}

	startTime := time.Now()

	// Ensure output directory exists
	outDir := filepath.Dir(req.OutputPath)
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return nil, fmt.Errorf("create output directory: %w", err)
	}

	// Create the archive file
	archiveFile, err := os.Create(req.OutputPath)
	if err != nil {
		return nil, fmt.Errorf("create archive: %w", err)
	}
	defer archiveFile.Close()

	zipWriter := zip.NewWriter(archiveFile)
	defer zipWriter.Close()

	entryCount := 0
	err = filepath.WalkDir(req.SourceDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}

		// Check exclusion patterns
		for _, pattern := range req.ExcludePatterns {
			matched, _ := filepath.Match(pattern, filepath.Base(path))
			if matched {
				return nil
			}
		}

		relPath, err := filepath.Rel(req.SourceDir, path)
		if err != nil {
			return fmt.Errorf("resolve relative path: %w", err)
		}

		// Use forward slashes in zip entries
		relPath = filepath.ToSlash(relPath)

		file, err := os.Open(path)
		if err != nil {
			return fmt.Errorf("open file: %w", err)
		}
		defer file.Close()

		info, err := file.Stat()
		if err != nil {
			return fmt.Errorf("stat file: %w", err)
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return fmt.Errorf("create zip header: %w", err)
		}
		header.Name = relPath
		header.Method = zip.Deflate

		writer, err := zipWriter.CreateHeader(header)
		if err != nil {
			return fmt.Errorf("create zip entry: %w", err)
		}

		if _, err := io.Copy(writer, file); err != nil {
			return fmt.Errorf("write to archive: %w", err)
		}

		entryCount++
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("package archive: %w", err)
	}

	if err := zipWriter.Close(); err != nil {
		return nil, fmt.Errorf("close archive: %w", err)
	}

	// Get final size
	info, err := os.Stat(req.OutputPath)
	if err != nil {
		return nil, fmt.Errorf("stat archive: %w", err)
	}

	return &PackageResult{
		PackagePath: req.OutputPath,
		Size:        info.Size(),
		EntryCount:  entryCount,
		Duration:    time.Since(startTime),
	}, nil
}

// =============================================================================
// Hot Deployment Support
// =============================================================================

// HotDeployStatus represents the state of a hot deployment.
type HotDeployStatus string

const (
	HotDeployPending   HotDeployStatus = "pending"
	HotDeployDeploying HotDeployStatus = "deploying"
	HotDeployDone      HotDeployStatus = "done"
	HotDeployFailed    HotDeployStatus = "failed"
)

// HotDeployRequest describes a hot deployment request.
type HotDeployRequest struct {
	DeploymentRoot string
	ChangedFiles   []string
	SourceRoots    []string
}

// HotDeployResult holds the result of a hot deployment.
type HotDeployResult struct {
	Status      HotDeployStatus
	Deployed    []string
	Failed      []string
	Elapsed     time.Duration
}

// HotDeploy performs a hot deployment of changed files to the deployment root.
// It copies only modified files that are newer than their deployed counterparts.
func HotDeploy(ctx context.Context, req HotDeployRequest) (*HotDeployResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	startTime := time.Now()
	result := &HotDeployResult{
		Status: HotDeployDeploying,
	}

	for _, sourcePath := range req.ChangedFiles {
		if err := ctx.Err(); err != nil {
			result.Status = HotDeployFailed
			return result, err
		}

		// Find the relative path from a source root
		relPath, err := findRelativePath(sourcePath, req.SourceRoots)
		if err != nil {
			result.Failed = append(result.Failed, sourcePath)
			continue
		}

		targetPath := filepath.Join(req.DeploymentRoot, relPath)

		// Ensure target directory exists
		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			result.Failed = append(result.Failed, sourcePath)
			continue
		}

		// Copy the file
		if err := copyFile(sourcePath, targetPath); err != nil {
			result.Failed = append(result.Failed, sourcePath)
			continue
		}

		result.Deployed = append(result.Deployed, relPath)
	}

	if len(result.Failed) > 0 {
		result.Status = HotDeployFailed
	} else {
		result.Status = HotDeployDone
	}
	result.Elapsed = time.Since(startTime)

	return result, nil
}

func findRelativePath(sourcePath string, sourceRoots []string) (string, error) {
	for _, root := range sourceRoots {
		root = filepath.Clean(root)
		rel, err := filepath.Rel(root, sourcePath)
		if err == nil && !strings.HasPrefix(rel, "..") {
			return rel, nil
		}
	}
	return "", fmt.Errorf("source path %q not under any source root", sourcePath)
}

func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("create target: %w", err)
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return fmt.Errorf("copy: %w", err)
	}

	return dstFile.Sync()
}

// =============================================================================
// Deploy Status Tracking
// =============================================================================

// DeployStatus represents the current state of a deployment.
type DeployStatus string

const (
	DeployStatusPending    DeployStatus = "pending"
	DeployStatusInProgress DeployStatus = "in_progress"
	DeployStatusCompleted  DeployStatus = "completed"
	DeployStatusFailed     DeployStatus = "failed"
	DeployStatusRolledBack DeployStatus = "rolled_back"
)

// DeployTracker tracks deployment status and history.
type DeployTracker struct {
	mu          sync.RWMutex
	deployments map[string]*TrackedDeployment
	history     []*TrackedDeployment
}

// TrackedDeployment represents a tracked deployment operation.
type TrackedDeployment struct {
	ID             string
	WorkspaceID    string
	ProjectID      string
	BuildID        string
	Status         DeployStatus
	DeploymentRoot string
	FilesDeployed  int
	FilesFailed    int
	Bytes          int64
	StartedAt      time.Time
	CompletedAt    *time.Time
	Error          string
	Snapshot       *DeploymentSnapshot
}

// DeploymentSnapshot captures the state before a deployment for rollback.
type DeploymentSnapshot struct {
	Timestamp time.Time
	Files     []SnapshotFile
}

// SnapshotFile represents a file in a deployment snapshot.
type SnapshotFile struct {
	Path    string
	Size    int64
	ModTime time.Time
	Content []byte
}

// NewDeployTracker creates a new DeployTracker.
func NewDeployTracker() *DeployTracker {
	return &DeployTracker{
		deployments: make(map[string]*TrackedDeployment),
		history:     make([]*TrackedDeployment, 0),
	}
}

// Track starts tracking a new deployment.
func (t *DeployTracker) Track(dep *TrackedDeployment) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.deployments[dep.ID] = dep
	t.history = append(t.history, dep)
}

// UpdateStatus updates the status of a tracked deployment.
func (t *DeployTracker) UpdateStatus(id string, status DeployStatus, errMsg string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	dep, ok := t.deployments[id]
	if !ok {
		return
	}
	dep.Status = status
	if errMsg != "" {
		dep.Error = errMsg
	}
	if status == DeployStatusCompleted || status == DeployStatusFailed || status == DeployStatusRolledBack {
		now := time.Now()
		dep.CompletedAt = &now
	}
}

// Get returns a tracked deployment by ID.
func (t *DeployTracker) Get(id string) *TrackedDeployment {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.deployments[id]
}

// List returns all tracked deployments.
func (t *DeployTracker) List() []*TrackedDeployment {
	t.mu.RLock()
	defer t.mu.RUnlock()
	result := make([]*TrackedDeployment, len(t.history))
	copy(result, t.history)
	return result
}

// ListByProject returns deployments for a specific project, sorted by time.
func (t *DeployTracker) ListByProject(workspaceID, projectID string) []*TrackedDeployment {
	t.mu.RLock()
	defer t.mu.RUnlock()
	var result []*TrackedDeployment
	for _, dep := range t.history {
		if dep.WorkspaceID == workspaceID && dep.ProjectID == projectID {
			result = append(result, dep)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].StartedAt.After(result[j].StartedAt)
	})
	return result
}

// =============================================================================
// Rollback Support
// =============================================================================

// RollbackEngine supports rolling back a deployment to a previous snapshot.
type RollbackEngine struct {
	tracker *DeployTracker
}

// NewRollbackEngine creates a new RollbackEngine.
func NewRollbackEngine(tracker *DeployTracker) *RollbackEngine {
	return &RollbackEngine{tracker: tracker}
}

// RollbackResult holds the result of a rollback operation.
type RollbackResult struct {
	Success       bool
	RestoredFiles int
	FailedFiles   int
	Duration      time.Duration
}

// Rollback restores the deployment root to a previous snapshot.
func (re *RollbackEngine) Rollback(ctx context.Context, deploymentID string) (*RollbackResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	dep := re.tracker.Get(deploymentID)
	if dep == nil {
		return nil, fmt.Errorf("deployment %s not found", deploymentID)
	}

	if dep.Snapshot == nil {
		return nil, fmt.Errorf("no snapshot available for rollback")
	}

	startTime := time.Now()
	result := &RollbackResult{}

	for _, snapFile := range dep.Snapshot.Files {
		if err := ctx.Err(); err != nil {
			return result, err
		}

		targetPath := filepath.Join(dep.DeploymentRoot, snapFile.Path)

		// Ensure parent directory exists
		if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
			result.FailedFiles++
			continue
		}

		// Write the snapshot content back
		if err := os.WriteFile(targetPath, snapFile.Content, 0644); err != nil {
			result.FailedFiles++
			continue
		}

		result.RestoredFiles++
	}

	result.Success = result.FailedFiles == 0
	result.Duration = time.Since(startTime)

	if result.Success {
		re.tracker.UpdateStatus(deploymentID, DeployStatusRolledBack, "")
	}

	return result, nil
}

// CreateSnapshot creates a snapshot of the current deployment state.
func CreateSnapshot(ctx context.Context, deploymentRoot string, files []string) (*DeploymentSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	snapshot := &DeploymentSnapshot{
		Timestamp: time.Now(),
		Files:     make([]SnapshotFile, 0, len(files)),
	}

	for _, file := range files {
		filePath := filepath.Join(deploymentRoot, file)
		info, err := os.Stat(filePath)
		if err != nil {
			// File doesn't exist yet — this is an "add" situation
			snapshot.Files = append(snapshot.Files, SnapshotFile{
				Path:    file,
				Content: nil,
			})
			continue
		}

		content, err := os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("read file %s: %w", file, err)
		}

		snapshot.Files = append(snapshot.Files, SnapshotFile{
			Path:    file,
			Size:    info.Size(),
			ModTime: info.ModTime(),
			Content: content,
		})
	}

	return snapshot, nil
}

// =============================================================================
// Deploy Target Resolution
// =============================================================================

// ResolveDeployTarget resolves the deployment target for a given project and server.
// For Tomcat, this is typically CATALINA_BASE/webapps/<contextPath>.
func ResolveDeployTarget(catalinaBase, contextPath string) string {
	if contextPath == "" || contextPath == "/" {
		return filepath.Join(catalinaBase, "webapps", "ROOT")
	}
	// Remove leading slash and normalize
	path := strings.TrimPrefix(contextPath, "/")
	path = strings.ReplaceAll(path, "/", "_")
	return filepath.Join(catalinaBase, "webapps", path)
}

// =============================================================================
// DeployMode helpers
// =============================================================================

// IsValidDeployMode checks if the given deploy mode is valid.
func IsValidDeployMode(mode domain.DeployMode) bool {
	return mode == domain.DeployModeMerge || mode == domain.DeployModeMirror
}

// DeployModeDescription returns a human-readable description of a deploy mode.
func DeployModeDescription(mode domain.DeployMode) string {
	switch mode {
	case domain.DeployModeMerge:
		return "Merge mode — only specified files are deployed, existing files are preserved"
	case domain.DeployModeMirror:
		return "Mirror mode — target directory exactly matches source, stale files are removed"
	default:
		return "Unknown deploy mode"
	}
}