package planning

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
)

type DefaultPlanResolver struct {
	workspaces domain.WorkspaceRepository
	projects   domain.ProjectRepository
	toolchains domain.ToolchainRepository
	pathPolicy pathpolicy.PathAuthorizer
}

func NewDefaultPlanResolver(
	workspaces domain.WorkspaceRepository,
	projects domain.ProjectRepository,
	toolchains domain.ToolchainRepository,
	pathPolicy pathpolicy.PathAuthorizer,
) *DefaultPlanResolver {
	return &DefaultPlanResolver{
		workspaces: workspaces,
		projects:   projects,
		toolchains: toolchains,
		pathPolicy: pathPolicy,
	}
}

func (r *DefaultPlanResolver) ResolveProject(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) (*domain.ResolvedProject, error) {
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(projectID)); err != nil {
		return nil, fmt.Errorf("invalid project id: %w", err)
	}

	ws, err := r.workspaces.Get(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("get workspace: %w", err)
	}

	project, err := r.projects.Get(ctx, workspaceID, projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	wsRoot, err := canonicalExistingDir(ws.Root)
	if err != nil {
		return nil, fmt.Errorf("canonicalize workspace root: %w", err)
	}

	projectRoot, err := r.pathPolicy.ResolveWithin(wsRoot, project.Root)
	if err != nil {
		return nil, fmt.Errorf("resolve project root: %w", err)
	}
	if _, err := os.Stat(projectRoot); err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrProjectRootMoved, err)
	}

	sourceRoots, err := r.resolvePaths(projectRoot, project.SourceRoots, false)
	if err != nil {
		return nil, fmt.Errorf("resolve source roots: %w", err)
	}

	resourceRoots, err := r.resolvePaths(projectRoot, project.ResourceRoots, true)
	if err != nil {
		return nil, fmt.Errorf("resolve resource roots: %w", err)
	}

	libraryDirs, err := r.resolvePaths(projectRoot, project.LibraryDirs, true)
	if err != nil {
		return nil, fmt.Errorf("resolve library dirs: %w", err)
	}

	outputDir, err := r.pathPolicy.ResolveWithin(projectRoot, project.OutputDir)
	if err != nil {
		return nil, fmt.Errorf("resolve output dir: %w", err)
	}

	buildFile := ""
	if project.BuildFile != "" {
		buildFile, err = r.pathPolicy.ResolveWithin(projectRoot, project.BuildFile)
		if err != nil {
			return nil, fmt.Errorf("resolve build file: %w", err)
		}
	}

	webappDir := ""
	if project.WebappDir != "" {
		webappDir, err = r.pathPolicy.ResolveWithin(projectRoot, project.WebappDir)
		if err != nil {
			return nil, fmt.Errorf("resolve webapp dir: %w", err)
		}
	}

	classpath, err := r.gatherLibraries(libraryDirs)
	if err != nil {
		return nil, fmt.Errorf("gather libraries: %w", err)
	}

	return &domain.ResolvedProject{
		Project:       *project,
		Root:          projectRoot,
		SourceRoots:   sourceRoots,
		ResourceRoots: resourceRoots,
		LibraryDirs:   libraryDirs,
		WebappDir:     webappDir,
		OutputDir:     outputDir,
		BuildFile:     buildFile,
		Classpath:     classpath,
	}, nil
}

func (r *DefaultPlanResolver) ResolveBuild(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, intent domain.BuildIntent, clean bool, selectedFiles []string) (*domain.BuildPlan, error) {
	resolved, err := r.ResolveProject(ctx, workspaceID, projectID)
	if err != nil {
		return nil, err
	}

	project := resolved.Project

	if project.BuildTool != domain.BuildToolAnt && project.BuildTool != domain.BuildToolJavac {
		return nil, fmt.Errorf("%w: %s", domain.ErrUnsupportedBuildTool, project.BuildTool)
	}

	javaHome := ""
	if project.ToolchainID != "" {
		tc, err := r.toolchains.Get(ctx, project.ToolchainID)
		if err != nil {
			return nil, fmt.Errorf("get toolchain: %w", err)
		}
		javaHome = tc.JavaHome
	}

	if len(resolved.SourceRoots) == 0 {
		return nil, fmt.Errorf("%w: no source roots configured", domain.ErrInvalidConfig)
	}
	if resolved.OutputDir == "" {
		return nil, fmt.Errorf("%w: output dir not configured", domain.ErrInvalidConfig)
	}
	if project.BuildTool == domain.BuildToolAnt && resolved.BuildFile == "" {
		return nil, fmt.Errorf("%w: ant build requires build file", domain.ErrInvalidConfig)
	}

	resolvedSelected, err := r.validateSelectedFiles(resolved.Root, resolved.SourceRoots, selectedFiles)
	if err != nil {
		return nil, err
	}

	targets := project.BuildTargets
	if len(targets) == 0 && project.BuildTool == domain.BuildToolAnt {
		targets = []string{"compile"}
	}

	classpath := append([]string{}, resolved.Classpath...)
	classpath = append(classpath, resolved.OutputDir)
	classpath = uniqueSorted(classpath)

	return &domain.BuildPlan{
		WorkspaceID:   workspaceID,
		ProjectID:     projectID,
		ProjectRoot:   resolved.Root,
		BuildTool:     project.BuildTool,
		BuildFile:     resolved.BuildFile,
		Targets:       targets,
		SourceRoots:   resolved.SourceRoots,
		OutputDir:     resolved.OutputDir,
		Classpath:     classpath,
		JavaHome:      javaHome,
		SourceLevel:   project.SourceLevel,
		TargetLevel:   project.TargetLevel,
		Encoding:      project.Encoding,
		Clean:         clean,
		SelectedFiles: resolvedSelected,
	}, nil
}

func (r *DefaultPlanResolver) ResolveDeploy(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, buildID domain.BuildID, target domain.DeploymentTarget) (*domain.DeployPlan, error) {
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(projectID)); err != nil {
		return nil, fmt.Errorf("invalid project id: %w", err)
	}
	if err := pathpolicy.ValidateBuildID(string(buildID)); err != nil {
		return nil, fmt.Errorf("invalid build id: %w", err)
	}
	if err := pathpolicy.ValidateServerID(string(target.ServerID)); err != nil {
		return nil, fmt.Errorf("invalid server id: %w", err)
	}

	if !target.OwnerToken.Valid() {
		return nil, domain.ErrInvalidOwnerToken
	}

	if target.WorkspaceID != workspaceID {
		return nil, fmt.Errorf("%w: target workspace mismatch", domain.ErrDeploymentTargetMismatch)
	}
	if target.ProjectID != projectID {
		return nil, fmt.Errorf("%w: target project mismatch", domain.ErrDeploymentTargetMismatch)
	}
	if target.Root == "" {
		return nil, fmt.Errorf("deployment root is required")
	}

	resolved, err := r.ResolveProject(ctx, workspaceID, projectID)
	if err != nil {
		return nil, err
	}

	var entries []domain.DeployEntry
	targetMap := make(map[string]string)

	if resolved.WebappDir != "" {
		webappEntries, err := r.walkDeployFileEntries(resolved.WebappDir, "", targetMap)
		if err != nil {
			return nil, err
		}
		entries = append(entries, webappEntries...)
	}

	classesEntries, err := r.walkDeployFileEntries(resolved.OutputDir, "WEB-INF/classes", targetMap)
	if err != nil {
		return nil, err
	}
	entries = append(entries, classesEntries...)

	for _, lr := range resolved.ResourceRoots {
		resEntries, err := r.walkDeployFileEntries(lr, "WEB-INF/classes", targetMap)
		if err != nil {
			return nil, err
		}
		entries = append(entries, resEntries...)
	}

	seenLibs := make(map[string]bool)
	for _, jar := range resolved.Classpath {
		if strings.HasSuffix(strings.ToLower(jar), ".jar") {
			base := filepath.Base(jar)
			if seenLibs[base] {
				continue
			}
			seenLibs[base] = true
			targetPath := "WEB-INF/lib/" + base
			if err := r.checkTargetCollision(targetPath, jar, targetMap); err != nil {
				return nil, err
			}
			fi, err := os.Lstat(jar)
			if err != nil {
				continue
			}
			if fi.IsDir() || fi.Mode()&os.ModeSymlink != 0 {
				continue
			}
			entries = append(entries, domain.DeployEntry{
				Source: jar,
				Target: targetPath,
				Action: domain.DeployActionAdd,
				Size:   fi.Size(),
				Mode:   0644,
			})
		}
	}

	return &domain.DeployPlan{
		WorkspaceID:    workspaceID,
		ProjectID:      projectID,
		BuildID:        buildID,
		DeploymentRoot: target.Root,
		OwnerToken:     target.OwnerToken,
		Entries:        entries,
		Mode:           domain.DeployModeMerge,
	}, nil
}

func (r *DefaultPlanResolver) ResolveRuntime(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) (*domain.RuntimePlan, error) {
	return nil, domain.ErrRuntimeIntegrationRequired
}

func (r *DefaultPlanResolver) resolvePaths(root string, rels []string, allowEmpty bool) ([]string, error) {
	var resolved []string
	for _, rel := range rels {
		if rel == "" && allowEmpty {
			continue
		}
		p, err := r.pathPolicy.ResolveWithin(root, rel)
		if err != nil {
			return nil, err
		}
		resolved = append(resolved, p)
	}
	return resolved, nil
}

func (r *DefaultPlanResolver) gatherLibraries(libraryDirs []string) ([]string, error) {
	var jars []string
	seen := make(map[string]bool)

	for _, dir := range libraryDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if !strings.HasSuffix(strings.ToLower(name), ".jar") {
				continue
			}
			full := filepath.Join(dir, name)
			abs, err := filepath.Abs(full)
			if err != nil {
				return nil, err
			}
			clean := filepath.Clean(abs)
			if !seen[clean] {
				seen[clean] = true
				jars = append(jars, clean)
			}
		}
	}

	sort.Strings(jars)
	return jars, nil
}

func (r *DefaultPlanResolver) validateSelectedFiles(projectRoot string, sourceRoots []string, selectedFiles []string) ([]string, error) {
	if len(selectedFiles) == 0 {
		return nil, nil
	}

	var resolved []string
	for _, f := range selectedFiles {
		if err := r.pathPolicy.ValidateRelativeConfigPath(f, false); err != nil {
			return nil, fmt.Errorf("invalid selected file path: %w", err)
		}
		abs, err := r.pathPolicy.ResolveWithin(projectRoot, f)
		if err != nil {
			return nil, fmt.Errorf("resolve selected file: %w", err)
		}
		if !strings.HasSuffix(strings.ToLower(abs), ".java") {
			return nil, fmt.Errorf("selected file is not a .java file: %s", f)
		}
		inRoot := false
		for _, sr := range sourceRoots {
			if isLexicallyUnder(abs, sr) {
				inRoot = true
				break
			}
		}
		if !inRoot {
			return nil, fmt.Errorf("%w: %s", domain.ErrSelectedFileEscape, f)
		}
		resolved = append(resolved, abs)
	}
	return resolved, nil
}

func (r *DefaultPlanResolver) walkDeployFileEntries(srcDir, targetPrefix string, targetMap map[string]string) ([]domain.DeployEntry, error) {
	var entries []domain.DeployEntry

	if _, err := os.Stat(srcDir); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	err := filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		target := filepath.ToSlash(filepath.Join(targetPrefix, rel))
		if err := pathpolicy.ValidateDeployTarget(target); err != nil {
			return err
		}
		if err := r.checkTargetCollision(target, path, targetMap); err != nil {
			return err
		}
		entries = append(entries, domain.DeployEntry{
			Source: path,
			Target: target,
			Action: domain.DeployActionAdd,
			Size:   info.Size(),
			Mode:   0644,
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	return entries, nil
}

func (r *DefaultPlanResolver) checkTargetCollision(target, source string, targetMap map[string]string) error {
	existingSource, exists := targetMap[target]
	if exists {
		if existingSource != source {
			return fmt.Errorf("%w: target %s from %s and %s", domain.ErrDuplicateTarget, target, existingSource, source)
		}
		return nil
	}
	srcInfo, err := os.Stat(source)
	if err != nil {
		if os.IsNotExist(err) {
			targetMap[target] = source
			return nil
		}
		return err
	}
	srcIsDir := srcInfo.IsDir()
	for existingTarget := range targetMap {
		if existingTarget == target {
			continue
		}
		prefix := existingTarget + "/"
		if strings.HasPrefix(target, prefix) {
			existingInfo, err := os.Stat(targetMap[existingTarget])
			if err == nil {
				if existingInfo.IsDir() != srcIsDir {
					return fmt.Errorf("%w: %s (file/dir mismatch)", domain.ErrTargetCollision, target)
				}
			}
		}
		prefix2 := target + "/"
		if strings.HasPrefix(existingTarget, prefix2) {
			existingInfo, err := os.Stat(targetMap[existingTarget])
			if err == nil {
				if existingInfo.IsDir() != srcIsDir {
					return fmt.Errorf("%w: %s (file/dir mismatch)", domain.ErrTargetCollision, target)
				}
			}
		}
	}
	targetMap[target] = source
	return nil
}

func fileMode(info os.FileInfo) int {
	if info.IsDir() {
		return 0755
	}
	return 0644
}

func uniqueSorted(paths []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, p := range paths {
		if !seen[p] {
			seen[p] = true
			result = append(result, p)
		}
	}
	sort.Strings(result)
	return result
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
	if strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return false
	}
	return !strings.HasPrefix(rel, "..")
}

func canonicalExistingDir(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	clean := filepath.Clean(abs)
	if _, err := os.Stat(clean); err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(clean)
	if err != nil {
		return "", err
	}
	return real, nil
}
