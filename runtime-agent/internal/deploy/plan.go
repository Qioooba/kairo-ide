package deploy

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
)

var (
	ErrRootNotOwned        = errors.New("deployment root is not authorized")
	ErrEmptyTarget         = errors.New("empty target path")
	ErrAbsoluteTarget      = errors.New("absolute target path")
	ErrPathTraversal       = errors.New("path traversal in target")
	ErrDuplicateTarget     = errors.New("duplicate target")
	ErrCollision           = errors.New("file/directory collision at target path")
	ErrSourceNotFound      = errors.New("source not found")
	ErrSourceNotRegular    = errors.New("source is not a regular file")
	ErrSourceOutsideRoot   = errors.New("source resolves outside authorized area")
	ErrSymlinkEscape       = errors.New("symlink escapes deployment root")
	ErrDeleteOutsideRoot   = errors.New("refusing to delete outside root")
	ErrDeleteRoot          = errors.New("refusing to delete deployment root itself")
	ErrMirrorNotKairoOwned = errors.New("mirror mode requires Kairo-owned root")
	ErrRootAlreadyExists   = errors.New("deployment root already exists but is not a directory")
)

var defaultProtectedPaths = []string{
	".kairo",
}

type ValidatedEntry struct {
	Entry          domain.DeployEntry
	ResolvedSource string
	ResolvedTarget string
	TargetDir      string
	TargetBase     string
	TargetSlash    string
}

type ValidatedPlan struct {
	DeploymentRoot    string
	RootCanon         string
	OwnerToken        domain.DeploymentOwnerToken
	AllowedSourceDirs []string
	Entries           []ValidatedEntry
	KeepSet           map[string]bool
	ProtectedPaths    map[string]bool
	Mode              domain.DeployMode
}

type PlanBuilder struct {
	policy         *pathpolicy.DefaultPathPolicy
	protectedPaths []string
}

func NewPlanBuilder() *PlanBuilder {
	return &PlanBuilder{
		policy:         pathpolicy.NewDefaultPathPolicy(),
		protectedPaths: append([]string{}, defaultProtectedPaths...),
	}
}

func (b *PlanBuilder) WithProtectedPaths(paths []string) *PlanBuilder {
	b.protectedPaths = append([]string{}, paths...)
	return b
}

func (b *PlanBuilder) Build(ctx context.Context, plan domain.DeployPlan, allowedSourceDirs []string) (*ValidatedPlan, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	if !plan.OwnerToken.Valid() {
		return nil, domain.ErrInvalidOwnerToken
	}

	if plan.DeploymentRoot == "" {
		return nil, ErrRootNotOwned
	}

	rootLexical, err := filepath.Abs(plan.DeploymentRoot)
	if err != nil {
		return nil, fmt.Errorf("canonicalize root: %w", err)
	}
	rootLexical = filepath.Clean(rootLexical)

	type prelimEntry struct {
		idx         int
		entry       domain.DeployEntry
		targetSlash string
	}

	var prelim []prelimEntry
	targetMapLex := make(map[string]int)
	targetIsDirLex := make(map[string]bool)

	for i, entry := range plan.Entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		if err := pathpolicy.ValidateDeployTarget(entry.Target); err != nil {
			return nil, fmt.Errorf("entry %d target %q: %w", i, entry.Target, err)
		}

		targetSlash := filepath.ToSlash(entry.Target)
		resolvedTargetLex, err := b.policy.ResolveWithinNoFollow(rootLexical, entry.Target)
		if err != nil {
			return nil, fmt.Errorf("entry %d target resolution: %w", i, err)
		}

		if existingIdx, exists := targetMapLex[resolvedTargetLex]; exists {
			return nil, fmt.Errorf("entry %d target %q: %w (conflicts with entry %d)", i, entry.Target, ErrDuplicateTarget, existingIdx)
		}

		if err := checkCollisions(resolvedTargetLex, targetMapLex, targetIsDirLex, false); err != nil {
			return nil, fmt.Errorf("entry %d: %w", i, err)
		}

		targetMapLex[resolvedTargetLex] = i
		prelim = append(prelim, prelimEntry{idx: i, entry: entry, targetSlash: targetSlash})
	}

	rootCanon, err := b.validateRootFilesystem(rootLexical)
	if err != nil {
		return nil, fmt.Errorf("root validation: %w", err)
	}

	if plan.Mode == domain.DeployModeMirror {
		if err := b.validateMirrorRoot(rootCanon); err != nil {
			return nil, err
		}
	}

	protected := b.buildProtectedSet(rootCanon)

	canonAllowedSources, err := b.canonicalizeSourceDirs(allowedSourceDirs)
	if err != nil {
		return nil, fmt.Errorf("canonicalize allowed source dirs: %w", err)
	}

	vp := &ValidatedPlan{
		DeploymentRoot:    plan.DeploymentRoot,
		RootCanon:         rootCanon,
		OwnerToken:        plan.OwnerToken,
		AllowedSourceDirs: canonAllowedSources,
		Entries:           make([]ValidatedEntry, 0, len(prelim)),
		KeepSet:           make(map[string]bool),
		ProtectedPaths:    protected,
		Mode:              plan.Mode,
	}

	targetMap := make(map[string]int)
	targetIsDir := make(map[string]bool)

	for _, pe := range prelim {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		resolvedTarget, err := b.policy.ResolveWithinNoFollow(rootCanon, pe.entry.Target)
		if err != nil {
			return nil, fmt.Errorf("entry %d target resolution: %w", pe.idx, err)
		}

		if err := b.verifyNoSymlinkEscape(rootCanon, resolvedTarget); err != nil {
			return nil, fmt.Errorf("entry %d: %w", pe.idx, err)
		}

		if existingIdx, exists := targetMap[resolvedTarget]; exists {
			return nil, fmt.Errorf("entry %d target %q: %w (conflicts with entry %d)", pe.idx, pe.entry.Target, ErrDuplicateTarget, existingIdx)
		}

		if err := checkCollisions(resolvedTarget, targetMap, targetIsDir, false); err != nil {
			return nil, fmt.Errorf("entry %d: %w", pe.idx, err)
		}

		var resolvedSource string
		if pe.entry.Action != domain.DeployActionDelete {
			var err error
			resolvedSource, err = b.validateSource(pe.entry.Source, canonAllowedSources)
			if err != nil {
				return nil, fmt.Errorf("entry %d source %q: %w", pe.idx, pe.entry.Source, err)
			}
		}

		ve := ValidatedEntry{
			Entry:          pe.entry,
			ResolvedSource: resolvedSource,
			ResolvedTarget: resolvedTarget,
			TargetDir:      filepath.Dir(resolvedTarget),
			TargetBase:     filepath.Base(resolvedTarget),
			TargetSlash:    pe.targetSlash,
		}

		targetMap[resolvedTarget] = pe.idx
		vp.Entries = append(vp.Entries, ve)

		if pe.entry.Action != domain.DeployActionDelete {
			vp.KeepSet[resolvedTarget] = true
			markParents(vp.KeepSet, rootCanon, resolvedTarget)
		}
	}

	if plan.Mode == domain.DeployModeMirror {
		for p := range vp.KeepSet {
			if err := checkCollisions(p, targetMap, targetIsDir, true); err != nil {
				return nil, err
			}
		}
	}

	sort.Slice(vp.Entries, func(i, j int) bool {
		return vp.Entries[i].ResolvedTarget < vp.Entries[j].ResolvedTarget
	})

	return vp, nil
}

func (b *PlanBuilder) validateRootFilesystem(rootLexical string) (string, error) {
	info, err := os.Lstat(rootLexical)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("%w: %s", domain.ErrRootNotFound, rootLexical)
		}
		return "", err
	}

	if !info.IsDir() {
		return "", fmt.Errorf("%w: %s", ErrRootAlreadyExists, rootLexical)
	}

	realRoot, err := filepath.EvalSymlinks(rootLexical)
	if err != nil {
		return "", fmt.Errorf("eval symlinks root: %w", err)
	}
	realRoot = filepath.Clean(realRoot)

	return realRoot, nil
}

func (b *PlanBuilder) validateMirrorRoot(rootCanon string) error {
	if !b.isKairoOwnedExplodedWebappRoot(rootCanon) {
		return fmt.Errorf("%w: %s", ErrMirrorNotKairoOwned, rootCanon)
	}
	return nil
}

func (b *PlanBuilder) isKairoOwnedExplodedWebappRoot(rootCanon string) bool {
	parent := filepath.Dir(rootCanon)
	if parent == rootCanon {
		return false
	}
	parentBase := filepath.Base(parent)
	if parentBase != "webapps" {
		return false
	}
	grandParent := filepath.Dir(parent)
	if grandParent == parent {
		return false
	}
	if filepath.Base(grandParent) != "servers" {
		return false
	}
	greaterGrandParent := filepath.Dir(grandParent)
	if greaterGrandParent == grandParent {
		return false
	}
	if filepath.Base(greaterGrandParent) != "runtime" {
		return false
	}
	return true
}

func (b *PlanBuilder) canonicalizeSourceDirs(dirs []string) ([]string, error) {
	var result []string
	for _, d := range dirs {
		if d == "" {
			continue
		}
		abs, err := filepath.Abs(d)
		if err != nil {
			return nil, err
		}
		clean := filepath.Clean(abs)
		real, err := filepath.EvalSymlinks(clean)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				result = append(result, clean)
				continue
			}
			return nil, err
		}
		result = append(result, real)
	}
	return result, nil
}

func (b *PlanBuilder) validateSource(source string, allowedDirs []string) (string, error) {
	if source == "" {
		return "", ErrSourceNotFound
	}

	sourceCanon, err := filepath.Abs(source)
	if err != nil {
		return "", err
	}
	sourceCanon = filepath.Clean(sourceCanon)

	info, err := os.Lstat(sourceCanon)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", ErrSourceNotFound
		}
		return "", err
	}

	if info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("source is symlink: %w", ErrSourceNotRegular)
	}

	if !info.Mode().IsRegular() {
		return "", ErrSourceNotRegular
	}

	realSource, err := filepath.EvalSymlinks(sourceCanon)
	if err != nil {
		return "", err
	}
	realSource = filepath.Clean(realSource)

	if !b.isSourceAllowed(realSource, allowedDirs) {
		return "", fmt.Errorf("%w: %s", ErrSourceOutsideRoot, source)
	}

	return realSource, nil
}

func (b *PlanBuilder) isSourceAllowed(source string, allowedDirs []string) bool {
	for _, dir := range allowedDirs {
		if isLexicallyUnder(source, dir) || source == dir {
			return true
		}
	}
	return false
}

func (b *PlanBuilder) verifyNoSymlinkEscape(root, target string) error {
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return err
	}
	if rel == "." {
		return nil
	}

	segments := strings.Split(filepath.ToSlash(rel), "/")
	current := root

	for _, seg := range segments {
		if seg == "" || seg == "." {
			continue
		}
		next := filepath.Join(current, seg)

		info, err := os.Lstat(next)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return nil
		}

		if info.Mode()&os.ModeSymlink != 0 {
			resolved, err := filepath.EvalSymlinks(next)
			if err != nil {
				return fmt.Errorf("symlink resolution: %w", ErrSymlinkEscape)
			}
			resolved = filepath.Clean(resolved)

			if !isLexicallyUnder(resolved, root) {
				return ErrSymlinkEscape
			}
		}

		current = next
	}

	return nil
}

func recheckTargetAncestor(root, targetDir string) error {
	rel, err := filepath.Rel(root, targetDir)
	if err != nil {
		return fmt.Errorf("recheck rel: %w", ErrSymlinkEscape)
	}
	if rel == "." {
		return nil
	}

	segments := strings.Split(filepath.ToSlash(rel), "/")
	current := root

	for _, seg := range segments {
		if seg == "" || seg == "." {
			continue
		}
		next := filepath.Join(current, seg)

		info, err := os.Lstat(next)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return fmt.Errorf("recheck lstat: %w", err)
		}

		if info.Mode()&os.ModeSymlink != 0 {
			resolved, err := filepath.EvalSymlinks(next)
			if err != nil {
				return fmt.Errorf("recheck symlink eval: %w", ErrSymlinkEscape)
			}
			resolved = filepath.Clean(resolved)
			if !isLexicallyUnder(resolved, root) {
				return ErrSymlinkEscape
			}
		}

		current = next
	}

	return nil
}

func checkCollisions(target string, targetMap map[string]int, targetIsDir map[string]bool, isKeepSet bool) error {
	parent := filepath.Dir(target)
	for parent != filepath.Dir(parent) {
		if _, exists := targetMap[parent]; exists && !targetIsDir[parent] {
			if isKeepSet {
				delete(targetMap, parent)
				return nil
			}
			return fmt.Errorf("%w: parent %q is a file", ErrCollision, parent)
		}
		parent = filepath.Dir(parent)
	}

	for existing := range targetMap {
		if existing == target {
			continue
		}
		if strings.HasPrefix(existing, target+string(filepath.Separator)) {
			if targetIsDir[target] {
				continue
			}
			targetIsDir[target] = true
		}
	}

	return nil
}

func markParents(set map[string]bool, root, target string) {
	dir := filepath.Dir(target)
	for dir != root && strings.HasPrefix(dir, root) {
		set[dir] = true
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	set[root] = true
}

func (b *PlanBuilder) buildProtectedSet(root string) map[string]bool {
	protected := make(map[string]bool)
	for _, p := range b.protectedPaths {
		protected[filepath.Join(root, filepath.FromSlash(p))] = true
	}
	return protected
}

func isLexicallyUnder(child, parent string) bool {
	if child == parent {
		return true
	}
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	if rel == ".." {
		return false
	}
	if strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	return !strings.HasPrefix(rel, "..")
}

type StaleEntry struct {
	Path  string
	IsDir bool
	Depth int
}

func (vp *ValidatedPlan) CollectStaleEntries(ctx context.Context) ([]StaleEntry, error) {
	var files []StaleEntry
	var dirs []StaleEntry

	err := filepath.WalkDir(vp.RootCanon, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}

		if path == vp.RootCanon {
			return nil
		}

		if vp.ProtectedPaths[path] || isProtectedPathPrefix(path, vp.ProtectedPaths, vp.RootCanon) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		if vp.KeepSet[path] {
			if d.IsDir() {
				return nil
			}
			return nil
		}

		depth := depthRelativeTo(vp.RootCanon, path)
		entry := StaleEntry{
			Path:  path,
			IsDir: d.IsDir(),
			Depth: depth,
		}

		if d.IsDir() {
			dirs = append(dirs, entry)
		} else {
			files = append(files, entry)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	sort.Slice(files, func(i, j int) bool {
		if files[i].Depth != files[j].Depth {
			return files[i].Depth > files[j].Depth
		}
		return files[i].Path < files[j].Path
	})

	sort.Slice(dirs, func(i, j int) bool {
		if dirs[i].Depth != dirs[j].Depth {
			return dirs[i].Depth > dirs[j].Depth
		}
		return dirs[i].Path < dirs[j].Path
	})

	result := append(files, dirs...)
	return result, nil
}

func isProtectedPathPrefix(path string, protected map[string]bool, root string) bool {
	for p := range protected {
		if path == p {
			return true
		}
		if strings.HasPrefix(path, p+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func depthRelativeTo(root, path string) int {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return 0
	}
	if rel == "." {
		return 0
	}
	return len(strings.Split(filepath.ToSlash(rel), "/"))
}
