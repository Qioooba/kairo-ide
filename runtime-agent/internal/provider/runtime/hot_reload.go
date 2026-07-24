package runtime

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/transport/events"
)

// HotReloadStatus represents the current state of hot reload.
type HotReloadStatus string

const (
	HotReloadSynced          HotReloadStatus = "synced"
	HotReloadCompiling       HotReloadStatus = "compiling"
	HotReloadRestartRequired HotReloadStatus = "restart_required"
)

// ChangeType classifies a detected file change.
type ChangeType string

const (
	ChangeTypeStatic ChangeType = "static"
	ChangeTypeJava   ChangeType = "java"
)

// FileChange represents a detected file change.
type FileChange struct {
	Path       string
	ChangeType ChangeType
	Timestamp  time.Time
}

// CompileCallback is invoked when Java source files change. It receives
// the list of changed .java files and should return an error if compilation
// fails. Returning a non-nil error triggers the RestartRequired status.
type CompileCallback func(ctx context.Context, changedFiles []string) error

// HotReloadConfig configures the hot reload behaviour.
type HotReloadConfig struct {
	WebappDir        string
	DeploymentDir    string
	SourceDirs       []string
	OutputDir        string
	PollInterval     time.Duration
	StaticExtensions []string
	SkipDirs         []string
}

// DefaultHotReloadConfig returns a sensible default configuration.
func DefaultHotReloadConfig() HotReloadConfig {
	return HotReloadConfig{
		PollInterval: 2 * time.Second,
		StaticExtensions: []string{
			".jsp", ".jspf", ".css", ".js", ".html", ".htm",
			".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
			".xml", ".properties", ".txt", ".json", ".woff", ".woff2", ".ttf",
		},
		SkipDirs: []string{".git", "node_modules", ".kairo", "WEB-INF"},
	}
}

// HotReloadWatcher polls directories for file changes and syncs them.
type HotReloadWatcher struct {
	mu             sync.RWMutex
	cfg            HotReloadConfig
	fileHashes     map[string]string
	status         HotReloadStatus
	onStatusChange func(HotReloadStatus)
	onCompile      CompileCallback
	eventHub       *events.EventHub
	workspaceID    string
	serverID       string
	cancel         context.CancelFunc
	running        bool
}

// NewHotReloadWatcher creates a new HotReloadWatcher.
func NewHotReloadWatcher(cfg HotReloadConfig) *HotReloadWatcher {
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 2 * time.Second
	}
	if cfg.StaticExtensions == nil {
		cfg.StaticExtensions = DefaultHotReloadConfig().StaticExtensions
	}
	if cfg.SkipDirs == nil {
		cfg.SkipDirs = DefaultHotReloadConfig().SkipDirs
	}
	return &HotReloadWatcher{
		cfg:        cfg,
		fileHashes: make(map[string]string),
		status:     HotReloadSynced,
	}
}

// SetEventHub attaches an EventHub for publishing status changes to frontends.
func (w *HotReloadWatcher) SetEventHub(hub *events.EventHub, workspaceID, serverID string) {
	w.eventHub = hub
	w.workspaceID = workspaceID
	w.serverID = serverID
}

// SetCompileCallback sets the callback invoked when Java sources change.
func (w *HotReloadWatcher) SetCompileCallback(fn CompileCallback) {
	w.onCompile = fn
}

// SetStatusChangeCallback sets a local callback for status changes.
func (w *HotReloadWatcher) SetStatusChangeCallback(fn func(HotReloadStatus)) {
	w.onStatusChange = fn
}

func (w *HotReloadWatcher) setStatus(status HotReloadStatus) {
	w.mu.Lock()
	old := w.status
	w.status = status
	w.mu.Unlock()
	if old != status {
		if w.onStatusChange != nil {
			w.onStatusChange(status)
		}
		w.publishStatusEvent(status)
	}
}

func (w *HotReloadWatcher) publishStatusEvent(status HotReloadStatus) {
	if w.eventHub == nil {
		return
	}
	hotReloadData, _ := json.Marshal(map[string]interface{}{
		"serverId": w.serverID,
		"status":   string(status),
	})
	w.eventHub.Publish(events.Event{
		Type:        events.EventHotReloadStatus,
		WorkspaceID: w.workspaceID,
		Message:     string(status),
		Data:        hotReloadData,
	})
}

// Status returns the current hot reload status.
func (w *HotReloadWatcher) Status() HotReloadStatus {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.status
}

// Start begins polling for file changes.
func (w *HotReloadWatcher) Start(ctx context.Context) {
	w.mu.Lock()
	if w.running {
		w.mu.Unlock()
		return
	}
	w.running = true
	ctx, w.cancel = context.WithCancel(ctx)
	w.mu.Unlock()

	go w.poll(ctx)
}

// Stop stops the watcher.
func (w *HotReloadWatcher) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.cancel != nil {
		w.cancel()
		w.cancel = nil
	}
	w.running = false
}

func (w *HotReloadWatcher) poll(ctx context.Context) {
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.scan(ctx)
		}
	}
}

func (w *HotReloadWatcher) scan(ctx context.Context) {
	var staticChanges []FileChange
	var javaChanges []FileChange
	newHashes := make(map[string]string)

	// Scan webapp directory for static files.
	if w.cfg.WebappDir != "" {
		changes, hashes := w.scanDir(ctx, w.cfg.WebappDir, w.isStaticFile, ChangeTypeStatic)
		staticChanges = append(staticChanges, changes...)
		for k, v := range hashes {
			newHashes[k] = v
		}
	}

	// Scan source directories for Java files.
	for _, dir := range w.cfg.SourceDirs {
		if dir == "" {
			continue
		}
		changes, hashes := w.scanDir(ctx, dir, func(p string) bool {
			return strings.HasSuffix(strings.ToLower(p), ".java")
		}, ChangeTypeJava)
		javaChanges = append(javaChanges, changes...)
		for k, v := range hashes {
			newHashes[k] = v
		}
	}

	// Update stored hashes.
	w.mu.Lock()
	for k, v := range newHashes {
		w.fileHashes[k] = v
	}
	for k := range w.fileHashes {
		if _, ok := newHashes[k]; !ok {
			delete(w.fileHashes, k)
		}
	}
	w.mu.Unlock()

	// Process static changes: copy each file to the deployment directory.
	if len(staticChanges) > 0 {
		for _, change := range staticChanges {
			if err := w.syncStaticFile(ctx, change.Path); err != nil {
				// Log but continue — a single file failure should not block others.
				continue
			}
		}
	}

	// Process Java changes: invoke the compile callback.
	if len(javaChanges) > 0 && w.onCompile != nil {
		var changedPaths []string
		for _, change := range javaChanges {
			changedPaths = append(changedPaths, change.Path)
		}
		w.setStatus(HotReloadCompiling)
		if err := w.onCompile(ctx, changedPaths); err != nil {
			w.setStatus(HotReloadRestartRequired)
		} else {
			w.setStatus(HotReloadSynced)
		}
	}
}

// syncStaticFile copies a single static file from the webapp source directory
// to the Tomcat deployment directory, preserving the relative path structure.
func (w *HotReloadWatcher) syncStaticFile(_ context.Context, sourcePath string) error {
	if w.cfg.DeploymentDir == "" || w.cfg.WebappDir == "" {
		return fmt.Errorf("deployment dir and webapp dir must be configured")
	}

	relPath, err := filepath.Rel(w.cfg.WebappDir, sourcePath)
	if err != nil {
		return fmt.Errorf("resolve relative path: %w", err)
	}
	if strings.HasPrefix(relPath, "..") {
		return fmt.Errorf("path escapes webapp dir: %s", relPath)
	}

	targetPath := filepath.Join(w.cfg.DeploymentDir, relPath)

	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return fmt.Errorf("create target dir: %w", err)
	}

	src, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer src.Close()

	dst, err := os.Create(targetPath)
	if err != nil {
		return fmt.Errorf("create target: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("copy file: %w", err)
	}

	return nil
}

func (w *HotReloadWatcher) scanDir(ctx context.Context, dir string, filter func(string) bool, changeType ChangeType) ([]FileChange, map[string]string) {
	var changes []FileChange
	hashes := make(map[string]string)

	_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			base := filepath.Base(path)
			for _, skip := range w.cfg.SkipDirs {
				if base == skip {
					return filepath.SkipDir
				}
			}
			return nil
		}
		if !filter(path) {
			return nil
		}

		hash, err := fileHash(path)
		if err != nil {
			return nil
		}
		hashes[path] = hash

		w.mu.RLock()
		oldHash, exists := w.fileHashes[path]
		w.mu.RUnlock()

		if !exists || oldHash != hash {
			changes = append(changes, FileChange{
				Path:       path,
				ChangeType: changeType,
				Timestamp:  info.ModTime(),
			})
		}

		return nil
	})

	return changes, hashes
}

func (w *HotReloadWatcher) isStaticFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	for _, staticExt := range w.cfg.StaticExtensions {
		if ext == staticExt {
			return true
		}
	}
	return false
}

func fileHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}