package app

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/repository"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
)

// BuildPlan is the resolved plan for executing a build.
type BuildPlan struct {
	ProjectRoot   string
	SourceRoots   []string
	OutputDir     string
	Classpath     []string
	Toolchain     domain.Toolchain
	BuildTool     string
	AntTarget     string
	AntFile       string
	SelectedFiles []string
}

// DeployPlan is the resolved plan for deploying build output.
type DeployPlan struct {
	ProjectRoot   string
	WebappDir     string
	OutputDir     string
	ResourceRoots []string
	LibDirs       []string
	TargetDir     string
	Scope         DeployScope
}

// DeployScope describes what to deploy.
type DeployScope string

const (
	DeployScopeAll       DeployScope = "all"
	DeployScopeClasses   DeployScope = "classes"
	DeployScopeWebapp    DeployScope = "webapp"
	DeployScopeResources DeployScope = "resources"
	DeployScopeLibs      DeployScope = "libs"
)

// RuntimePlan is the resolved plan for starting a runtime server.
type RuntimePlan struct {
	JavaHome     string
	CatalinaBase string
	WebappDir    string
	ContextPath  string
	Port         int
	ProjectRoot  string
}

// PlanResolver resolves domain entities into executable plans.
type PlanResolver struct {
	sandbox *security.WorkspaceRoots
	portAlloc domain.PortAllocator
}

// NewPlanResolver creates a new PlanResolver.
func NewPlanResolver(sandbox *security.WorkspaceRoots, portAlloc domain.PortAllocator) *PlanResolver {
	return &PlanResolver{
		sandbox:   sandbox,
		portAlloc: portAlloc,
	}
}

// ResolveBuild resolves a BuildPlan for a project.
func (r *PlanResolver) ResolveBuild(ctx context.Context, project domain.Project, intent domain.BuildIntent) (*BuildPlan, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	rootPath := project.RootPath
	if rootPath == "" {
		rootPath = project.Root
	}
	if rootPath == "" {
		return nil, fmt.Errorf("project has no root path")
	}

	// Resolve source roots from project config
	sourceRoots := project.SourceRoots
	if len(sourceRoots) == 0 {
		cfg, err := repository.LoadProjectConfig(rootPath)
		if err != nil {
			return nil, fmt.Errorf("load project config: %w", err)
		}
		sourceRoots = cfg.SourceRoots
	}

	// Resolve absolute source roots
	absSourceRoots := make([]string, 0, len(sourceRoots))
	for _, sr := range sourceRoots {
		abs := filepath.Join(rootPath, sr)
		absSourceRoots = append(absSourceRoots, abs)
	}

	// Resolve output dir
	outputDir := project.OutputDir
	if outputDir == "" {
		outputDir = "target/classes"
	}
	absOutputDir := filepath.Join(rootPath, outputDir)

	plan := &BuildPlan{
		ProjectRoot: rootPath,
		SourceRoots: absSourceRoots,
		OutputDir:   absOutputDir,
		BuildTool:   string(project.BuildTool),
	}

	if project.BuildTool == domain.BuildToolAnt {
		plan.AntFile = project.BuildFile
		if len(project.BuildTargets) > 0 {
			plan.AntTarget = project.BuildTargets[0]
		}
	}

	return plan, nil
}

// ResolveDeploy resolves a DeployPlan for a project after a build.
func (r *PlanResolver) ResolveDeploy(ctx context.Context, project domain.Project, buildID domain.BuildID) (*DeployPlan, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	rootPath := project.RootPath
	if rootPath == "" {
		rootPath = project.Root
	}
	if rootPath == "" {
		return nil, fmt.Errorf("project has no root path")
	}

	webappDir := project.WebappDir
	if webappDir == "" {
		webappDir = "src/main/webapp"
	}

	outputDir := project.OutputDir
	if outputDir == "" {
		outputDir = "target/classes"
	}

	resourceRoots := project.ResourceRoots
	if len(resourceRoots) == 0 {
		resourceRoots = []string{"src/main/resources"}
	}

	libDirs := project.LibraryDirs
	if len(libDirs) == 0 {
		libDirs = []string{"lib"}
	}

	return &DeployPlan{
		ProjectRoot:   rootPath,
		WebappDir:     filepath.Join(rootPath, webappDir),
		OutputDir:     filepath.Join(rootPath, outputDir),
		ResourceRoots: resolveAbsPaths(rootPath, resourceRoots),
		LibDirs:       resolveAbsPaths(rootPath, libDirs),
		TargetDir:     "", // filled by deploy use case
		Scope:         DeployScopeAll,
	}, nil
}

// ResolveRuntime resolves a RuntimePlan for a project.
func (r *PlanResolver) ResolveRuntime(ctx context.Context, project domain.Project) (*RuntimePlan, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	rootPath := project.RootPath
	if rootPath == "" {
		rootPath = project.Root
	}
	if rootPath == "" {
		return nil, fmt.Errorf("project has no root path")
	}

	contextPath := project.ContextPath
	if contextPath == "" {
		contextPath = "/"
	}

	webappDir := project.WebappDir
	if webappDir == "" {
		webappDir = "src/main/webapp"
	}

	plan := &RuntimePlan{
		ProjectRoot: rootPath,
		WebappDir:   filepath.Join(rootPath, webappDir),
		ContextPath: contextPath,
	}

	return plan, nil
}

func resolveAbsPaths(root string, rels []string) []string {
	out := make([]string, len(rels))
	for i, r := range rels {
		out[i] = filepath.Join(root, r)
	}
	return out
}