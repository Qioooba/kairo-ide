package deploy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/kairo-ide/runtime-agent/internal/atomicfile"
	"github.com/kairo-ide/runtime-agent/internal/domain"
)

type DeployResult struct {
	Partial     bool
	Succeeded   int
	Failed      int
	FailedFiles []DeployFailure
}

type DeployFailure struct {
	Entry  domain.DeployEntry
	Reason error
}

type DeployEngine interface {
	Execute(ctx context.Context, plan domain.DeployPlan, allowedSourceDirs []string) (*DeployResult, error)
}

type safeDeployEngine struct {
	builder *PlanBuilder
}

func NewDeployEngine() DeployEngine {
	return &safeDeployEngine{
		builder: NewPlanBuilder(),
	}
}

func NewDeployEngineWithBuilder(builder *PlanBuilder) DeployEngine {
	return &safeDeployEngine{
		builder: builder,
	}
}

func (e *safeDeployEngine) Execute(ctx context.Context, plan domain.DeployPlan, allowedSourceDirs []string) (*DeployResult, error) {
	result := &DeployResult{
		FailedFiles: make([]DeployFailure, 0),
	}

	vp, err := e.builder.Build(ctx, plan, allowedSourceDirs)
	if err != nil {
		return result, err
	}

	if err := ctx.Err(); err != nil {
		return result, err
	}

	for i, entry := range vp.Entries {
		if i%16 == 0 {
			if err := ctx.Err(); err != nil {
				result.Partial = true
				return result, err
			}
		}

		if err := e.executeEntry(ctx, vp, entry); err != nil {
			result.Failed++
			result.Partial = true
			result.FailedFiles = append(result.FailedFiles, DeployFailure{
				Entry:  entry.Entry,
				Reason: err,
			})
			continue
		}
		result.Succeeded++
	}

	if plan.Mode == domain.DeployModeMirror {
		stale, err := vp.CollectStaleEntries(ctx)
		if err != nil {
			result.Partial = true
			return result, fmt.Errorf("collect stale entries: %w", err)
		}

		for _, staleEntry := range stale {
			if err := ctx.Err(); err != nil {
				result.Partial = true
				return result, err
			}

			if err := e.deleteStaleEntry(vp, staleEntry); err != nil {
				result.Partial = true
				result.FailedFiles = append(result.FailedFiles, DeployFailure{
					Entry: domain.DeployEntry{
						Target: relPath(vp.RootCanon, staleEntry.Path),
						Action: domain.DeployActionDelete,
					},
					Reason: err,
				})
				result.Failed++
				continue
			}
		}
	}

	if result.Failed > 0 {
		return result, fmt.Errorf("%d files failed to deploy", result.Failed)
	}

	return result, nil
}

func (e *safeDeployEngine) executeEntry(ctx context.Context, vp *ValidatedPlan, entry ValidatedEntry) error {
	if entry.Entry.Action == domain.DeployActionDelete {
		return e.deleteEntry(vp, entry)
	}

	return e.copyEntry(ctx, vp, entry)
}

func (e *safeDeployEngine) copyEntry(ctx context.Context, vp *ValidatedPlan, entry ValidatedEntry) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	if err := verifyTargetUnderRoot(vp.RootCanon, entry.ResolvedTarget); err != nil {
		return err
	}

	if err := recheckTargetAncestor(vp.RootCanon, entry.TargetDir); err != nil {
		return fmt.Errorf("target ancestor recheck: %w", err)
	}

	if err := os.MkdirAll(entry.TargetDir, 0o755); err != nil {
		return fmt.Errorf("mkdir parent: %w", err)
	}

	parentInfo, err := os.Lstat(entry.TargetDir)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("stat parent: %w", err)
		}
	} else if parentInfo.Mode()&os.ModeSymlink != 0 {
		real, err := filepath.EvalSymlinks(entry.TargetDir)
		if err != nil {
			return fmt.Errorf("parent symlink eval: %w", err)
		}
		real = filepath.Clean(real)
		if !isLexicallyUnder(real, vp.RootCanon) {
			return ErrSymlinkEscape
		}
	}

	srcInfo, err := os.Lstat(entry.ResolvedSource)
	if err != nil {
		return fmt.Errorf("stat source: %w", err)
	}
	if srcInfo.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("source is symlink: %w", ErrSourceNotRegular)
	}
	if !srcInfo.Mode().IsRegular() {
		return ErrSourceNotRegular
	}

	in, err := os.Open(entry.ResolvedSource)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer in.Close()

	tmpPattern := ".kairo-deploy-*"
	tmp, err := os.CreateTemp(entry.TargetDir, tmpPattern)
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpPath := tmp.Name()

	cleanupTmp := true
	defer func() {
		if cleanupTmp {
			os.Remove(tmpPath)
		}
	}()

	if _, err := io.Copy(tmp, in); err != nil {
		tmp.Close()
		return fmt.Errorf("copy content: %w", err)
	}

	mode := os.FileMode(0o644)
	if entry.Entry.Mode != 0 {
		mode = os.FileMode(entry.Entry.Mode)
	} else {
		mode = srcInfo.Mode().Perm()
	}

	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return fmt.Errorf("chmod temp: %w", err)
	}

	if err := fsyncFile(tmp); err != nil {
		tmp.Close()
		return fmt.Errorf("fsync temp: %w", err)
	}

	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp: %w", err)
	}

	if err := recheckTargetAncestor(vp.RootCanon, entry.TargetDir); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("pre-replace ancestor recheck: %w", err)
	}

	if err := atomicReplace(tmpPath, entry.ResolvedTarget); err != nil {
		return fmt.Errorf("atomic replace: %w", err)
	}

	// Sync parent directory so the rename is durable.
	_ = atomicfile.SyncDir(filepath.Dir(entry.ResolvedTarget))

	cleanupTmp = false
	return nil
}

func (e *safeDeployEngine) deleteEntry(vp *ValidatedPlan, entry ValidatedEntry) error {
	if err := verifyTargetUnderRoot(vp.RootCanon, entry.ResolvedTarget); err != nil {
		return err
	}

	if entry.ResolvedTarget == vp.RootCanon {
		return ErrDeleteRoot
	}

	info, err := os.Lstat(entry.ResolvedTarget)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("stat delete target: %w", err)
	}

	if info.Mode()&os.ModeSymlink != 0 {
		return os.Remove(entry.ResolvedTarget)
	}

	if info.IsDir() {
		entries, err := os.ReadDir(entry.ResolvedTarget)
		if err != nil {
			return fmt.Errorf("read dir for delete: %w", err)
		}
		if len(entries) > 0 {
			return fmt.Errorf("refusing to delete non-empty directory")
		}
		return os.Remove(entry.ResolvedTarget)
	}

	return os.Remove(entry.ResolvedTarget)
}

func (e *safeDeployEngine) deleteStaleEntry(vp *ValidatedPlan, stale StaleEntry) error {
	if err := verifyTargetUnderRoot(vp.RootCanon, stale.Path); err != nil {
		return err
	}

	if stale.Path == vp.RootCanon {
		return ErrDeleteRoot
	}

	if vp.ProtectedPaths[stale.Path] || isProtectedPathPrefix(stale.Path, vp.ProtectedPaths, vp.RootCanon) {
		return nil
	}

	info, err := os.Lstat(stale.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	if info.Mode()&os.ModeSymlink != 0 {
		return os.Remove(stale.Path)
	}

	if info.IsDir() {
		entries, err := os.ReadDir(stale.Path)
		if err != nil {
			return err
		}
		hasStaleChildren := false
		for _, child := range entries {
			childPath := filepath.Join(stale.Path, child.Name())
			if !vp.KeepSet[childPath] && !vp.ProtectedPaths[childPath] && !isProtectedPathPrefix(childPath, vp.ProtectedPaths, vp.RootCanon) {
				hasStaleChildren = true
				break
			}
		}
		if hasStaleChildren {
			return nil
		}
		return os.Remove(stale.Path)
	}

	return os.Remove(stale.Path)
}

func verifyTargetUnderRoot(root, target string) error {
	if !isLexicallyUnder(target, root) {
		return fmt.Errorf("target %q escapes root %q: %w", target, root, ErrDeleteOutsideRoot)
	}
	return nil
}

func relPath(root, target string) string {
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return target
	}
	return filepath.ToSlash(rel)
}
