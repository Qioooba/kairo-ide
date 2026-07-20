package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
)

// ----------------- Deployer (disk, real) -----------------

type diskDeployer struct {
	mu     sync.Mutex
	dir    string
	logger *log.Logger
	items  map[string]*api.DeployResult
}

func newDiskDeployer(dataDir string, logger *log.Logger) *diskDeployer {
	dir := filepath.Join(dataDir, "deployments")
	_ = os.MkdirAll(dir, 0o755)
	d := &diskDeployer{
		dir:    dir,
		logger: logger,
		items:  map[string]*api.DeployResult{},
	}
	d.load()
	return d
}

func (d *diskDeployer) load() {
	p := filepath.Join(d.dir, "deployments.json")
	data, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var items []*api.DeployResult
	if err := json.Unmarshal(data, &items); err != nil {
		return
	}
	for _, r := range items {
		d.items[r.ID] = r
	}
}

func (d *diskDeployer) save() {
	items := make([]*api.DeployResult, 0, len(d.items))
	for _, r := range d.items {
		items = append(items, r)
	}
	data, _ := json.MarshalIndent(items, "", "  ")
	_ = atomicfile.WriteFile(filepath.Join(d.dir, "deployments.json"), data, 0o600)
}

func (d *diskDeployer) Publish(req api.DeployRequest) (*api.DeployResult, error) {
	if req.What == "" {
		req.What = "all"
	}
	if req.Trigger == "" {
		req.Trigger = "manual"
	}
	if req.Mode == "" {
		req.Mode = "merge"
	}
	if req.Mode != "merge" && req.Mode != "mirror" {
		return nil, fmt.Errorf("mode must be 'merge' or 'mirror'")
	}
	if req.Source == "" {
		return nil, errors.New("source is required")
	}
	if req.Target == "" {
		return nil, errors.New("target is required")
	}
	if _, err := os.Stat(req.Source); err != nil {
		return nil, fmt.Errorf("source not found: %w", err)
	}

	id := "dep_" + shortID()
	rec := &api.DeployResult{
		ID:            id,
		State:         "running",
		StartedAt:     time.Now(),
		ProjectID:     req.ProjectID,
		BuildID:       req.BuildID,
		What:          req.What,
		Source:        req.Source,
		Target:        req.Target,
		HotReloadMode: "staticSync",
		Trigger:       req.Trigger,
	}
	d.mu.Lock()
	d.items[id] = rec
	d.save()
	d.mu.Unlock()

	filesAdded, filesModified, filesDeleted, bytes, err := syncDir(req.Source, req.Target, req.Mode == "mirror")
	rec.FinishedAt = time.Now()
	if err != nil {
		rec.State = "failed"
		rec.Error = err.Error()
	} else {
		rec.State = "success"
		rec.FilesTouched = filesAdded + filesModified + filesDeleted
		rec.FilesAdded = filesAdded
		rec.FilesModified = filesModified
		rec.FilesDeleted = filesDeleted
		rec.Bytes = bytes
	}
	d.mu.Lock()
	d.save()
	d.mu.Unlock()
	return rec, nil
}

func (d *diskDeployer) Get(id string) (*api.DeployResult, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	r, ok := d.items[id]
	if !ok {
		return nil, fmt.Errorf("deployment not found: %s", id)
	}
	return r, nil
}

func (d *diskDeployer) List() []*api.DeployResult {
	d.mu.Lock()
	defer d.mu.Unlock()
	items := make([]*api.DeployResult, 0, len(d.items))
	for _, r := range d.items {
		items = append(items, r)
	}
	return items
}

// syncDir copies the file tree at src into dst using atomic copies.
// src may be a file or a directory. For a single file, dst is
// treated as the target file path. If dst ends in a directory
// separator or exists as a dir, the file is placed inside that
// directory using src's basename.
//
// When prune is true, any entry under dst that does not exist
// under src is removed (mirror semantics); when prune is false,
// only additions and updates are performed (merge semantics, the
// default for IDE deploys where multiple sources share a target).
// Returns (added, modified, deleted, bytes, err).
func syncDir(src, dst string, prune bool) (added, modified, deleted int, bytes int64, err error) {
	src = filepath.Clean(src)
	dst = filepath.Clean(dst)
	srcInfo, err := os.Stat(src)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	if !srcInfo.IsDir() {
		dstInfo, _ := os.Stat(dst)
		if dstInfo != nil && dstInfo.IsDir() {
			dst = filepath.Join(dst, filepath.Base(src))
		} else {
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return 0, 0, 0, 0, err
			}
		}
		a, m, b, e := copyOneFile(src, dst)
		return a, m, 0, b, e
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return 0, 0, 0, 0, err
	}
	seen := map[string]bool{}
	walkErr := filepath.WalkDir(src, func(path string, d os.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		rel, e := filepath.Rel(src, path)
		if e != nil {
			return e
		}
		if rel == "." {
			return nil
		}
		dp := filepath.Join(dst, rel)
		seen[dp] = true
		if d.IsDir() {
			return os.MkdirAll(dp, 0o755)
		}
		a, m, b, e := copyOneFile(path, dp)
		added += a
		modified += m
		bytes += b
		return e
	})
	if walkErr != nil {
		return added, modified, deleted, bytes, walkErr
	}
	if prune {
		if err := pruneUnseen(dst, seen, &deleted); err != nil {
			return added, modified, deleted, bytes, err
		}
	}
	return added, modified, deleted, bytes, nil
}

// pruneUnseen walks root with an explicit stack (NOT filepath.WalkDir)
// and removes anything not in seen.
//
// filepath.WalkDir is a DFS that reads a directory's entries, then
// recurses into each subdir. If the closure deletes a subdir that
// WalkDir has already cached as "a directory to recurse into",
// WalkDir then fails with a werr of the form
//
//	open <subdir>: no such file or directory
//
// because the dir was just removed. That werr surfaces to the caller
// as a spurious sync failure even though every file was copied and
// every stale entry was deleted. Doing the traversal by hand with
// os.ReadDir keeps the recursion in our control so a successful
// RemoveAll is never reported as a failure.
func pruneUnseen(root string, seen map[string]bool, deleted *int) error {
	type frame struct {
		path    string
		entries []os.DirEntry
		idx     int
	}
	rd, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	stack := []frame{{path: root, entries: rd}}
	for len(stack) > 0 {
		top := &stack[len(stack)-1]
		if top.idx >= len(top.entries) {
			stack = stack[:len(stack)-1]
			continue
		}
		entry := top.entries[top.idx]
		top.idx++
		child := filepath.Join(top.path, entry.Name())
		if !seen[child] {
			if err := os.RemoveAll(child); err != nil {
				return err
			}
			if !entry.IsDir() {
				*deleted++
			}
			// Do NOT descend into the removed child.
			continue
		}
		if entry.IsDir() {
			cd, err := os.ReadDir(child)
			if err != nil {
				if os.IsNotExist(err) {
					// Removed between seen-check and readdir; skip.
					continue
				}
				return err
			}
			stack = append(stack, frame{path: child, entries: cd})
		}
	}
	return nil
}

// copyOneFile copies src to dst atomically (temp + rename).
// Returns (added, modified, bytes) where added=1 if dst did not
// exist before and modified=1 if it existed.
func copyOneFile(src, dst string) (added, modified int, bytes int64, err error) {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return 0, 0, 0, err
	}
	srcInfo, err := os.Stat(src)
	if err != nil {
		return 0, 0, 0, err
	}
	existing, _ := os.Stat(dst)
	in, err := os.Open(src)
	if err != nil {
		return 0, 0, 0, err
	}
	defer in.Close()
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".kairo-tmp-*")
	if err != nil {
		return 0, 0, 0, err
	}
	tmpPath := tmp.Name()
	n, err := io.Copy(tmp, in)
	if err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return 0, 0, 0, err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return 0, 0, 0, err
	}
	// Preserve source permissions (especially the executable bit
	// for .sh/.bat/.cmd shipped under WebRoot/bin).
	if err := os.Chmod(tmpPath, srcInfo.Mode()); err != nil {
		os.Remove(tmpPath)
		return 0, 0, 0, err
	}
	if err := os.Rename(tmpPath, dst); err != nil {
		os.Remove(tmpPath)
		return 0, 0, 0, err
	}
	if existing == nil {
		added = 1
	} else {
		modified = 1
	}
	return added, modified, n, nil
}
