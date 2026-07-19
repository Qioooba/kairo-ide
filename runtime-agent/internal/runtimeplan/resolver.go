package runtimeplan

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/kairo-ide/runtime-agent/internal/catalinabase"
	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
)

type IDGenerator interface {
	NewServerID() (string, error)
}

type PlanResolver interface {
	ResolveRuntime(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, existingServerID *domain.ServerID) (*domain.RuntimePlan, error)
	ResolveDeploymentTarget(plan *domain.RuntimePlan) (domain.DeploymentTarget, error)
}

type DefaultRuntimePlanResolver struct {
	workspaces    domain.WorkspaceRepository
	projects      domain.ProjectRepository
	toolchains    domain.ToolchainRepository
	runtimes      RuntimeRegistry
	pathPolicy    pathpolicy.PathAuthorizer
	idGen         IDGenerator
	ports         PortAllocator
	dataRoot      string
	cbPlanner     catalinabase.Planner
	ownerTokenGen func() domain.DeploymentOwnerToken
}

type ResolverConfig struct {
	DataRoot   string
	Workspaces domain.WorkspaceRepository
	Projects   domain.ProjectRepository
	Toolchains domain.ToolchainRepository
	Runtimes   RuntimeRegistry
	PathPolicy pathpolicy.PathAuthorizer
	IDGen      IDGenerator
	Ports      PortAllocator
	CBPlanner  catalinabase.Planner
}

func NewDefaultRuntimePlanResolver(cfg ResolverConfig) (*DefaultRuntimePlanResolver, error) {
	if cfg.DataRoot == "" {
		return nil, fmt.Errorf("data root is required")
	}
	if cfg.Workspaces == nil {
		return nil, fmt.Errorf("workspace repository is required")
	}
	if cfg.Projects == nil {
		return nil, fmt.Errorf("project repository is required")
	}
	if cfg.Toolchains == nil {
		return nil, fmt.Errorf("toolchain repository is required")
	}
	if cfg.Runtimes == nil {
		return nil, fmt.Errorf("runtime registry is required")
	}
	if cfg.PathPolicy == nil {
		return nil, fmt.Errorf("path policy is required")
	}
	if cfg.IDGen == nil {
		return nil, fmt.Errorf("id generator is required")
	}
	if cfg.CBPlanner == nil {
		cfg.CBPlanner = catalinabase.NewDefaultPlanner()
	}
	if cfg.Ports == nil {
		cfg.Ports = NewDefaultPortAllocator(DefaultPortConfig())
	}

	absDataRoot, err := filepath.Abs(cfg.DataRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve data root: %w", err)
	}

	return &DefaultRuntimePlanResolver{
		workspaces:    cfg.Workspaces,
		projects:      cfg.Projects,
		toolchains:    cfg.Toolchains,
		runtimes:      cfg.Runtimes,
		pathPolicy:    cfg.PathPolicy,
		idGen:         cfg.IDGen,
		ports:         cfg.Ports,
		dataRoot:      absDataRoot,
		cbPlanner:     cfg.CBPlanner,
		ownerTokenGen: domain.NewDeploymentOwnerToken,
	}, nil
}

func (r *DefaultRuntimePlanResolver) ResolveRuntime(
	ctx context.Context,
	workspaceID domain.WorkspaceID,
	projectID domain.ProjectID,
	existingServerID *domain.ServerID,
) (*domain.RuntimePlan, error) {
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(projectID)); err != nil {
		return nil, fmt.Errorf("invalid project id: %w", err)
	}
	if existingServerID != nil {
		if err := pathpolicy.ValidateServerID(string(*existingServerID)); err != nil {
			return nil, fmt.Errorf("invalid existing server id: %w", err)
		}
	}

	ws, err := r.workspaces.Get(ctx, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("get workspace: %w", err)
	}

	project, err := r.projects.Get(ctx, workspaceID, projectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	if project.WorkspaceID != workspaceID {
		return nil, fmt.Errorf("%w: project %s does not belong to workspace %s",
			domain.ErrDeploymentTargetMismatch, projectID, workspaceID)
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

	javaHome := ""
	if project.ToolchainID != "" {
		tc, err := r.toolchains.Get(ctx, project.ToolchainID)
		if err != nil {
			return nil, fmt.Errorf("%w: get toolchain %s: %v", domain.ErrToolchainNotFound, project.ToolchainID, err)
		}
		javaHome = tc.JavaHome
	}

	if project.RuntimeID == "" {
		return nil, fmt.Errorf("%w: project has no runtime configured", domain.ErrInvalidConfig)
	}

	rt, err := r.runtimes.Get(ctx, project.RuntimeID)
	if err != nil {
		return nil, fmt.Errorf("%w: get runtime %s: %v", domain.ErrRuntimeNotFound, project.RuntimeID, err)
	}

	catalinaHome := rt.CatalinaHome
	if catalinaHome == "" {
		return nil, fmt.Errorf("runtime %s has no catalina home", project.RuntimeID)
	}
	if _, err := os.Stat(catalinaHome); err != nil {
		return nil, fmt.Errorf("catalina home %s: %w", catalinaHome, err)
	}

	if javaHome != "" {
		if _, err := os.Stat(javaHome); err != nil {
			return nil, fmt.Errorf("java home %s: %w", javaHome, err)
		}
	}

	var serverID domain.ServerID
	generation := uint64(1)
	if existingServerID != nil {
		serverID = *existingServerID
		generation = 0
	} else {
		idStr, err := r.idGen.NewServerID()
		if err != nil {
			return nil, fmt.Errorf("generate server id: %w", err)
		}
		serverID = domain.ServerID(idStr)
	}

	owner := catalinabase.OwnerMetadata{
		WorkspaceID: workspaceID,
		ProjectID:   projectID,
		ServerID:    serverID,
		RuntimeID:   project.RuntimeID,
	}

	cbPlan, err := r.cbPlanner.Plan(r.dataRoot, owner, project.ContextPath)
	if err != nil {
		return nil, fmt.Errorf("plan catalina base: %w", err)
	}

	webappDir := project.WebappDir
	if webappDir != "" {
		webappDir, err = r.pathPolicy.ResolveWithin(projectRoot, webappDir)
		if err != nil {
			return nil, fmt.Errorf("resolve webapp dir: %w", err)
		}
	}

	plan := &domain.RuntimePlan{
		WorkspaceID:    workspaceID,
		ProjectID:      projectID,
		ServerID:       serverID,
		RuntimeID:      project.RuntimeID,
		JavaHome:       javaHome,
		CatalinaHome:   catalinaHome,
		CatalinaBase:   cbPlan.Layout.BaseDir,
		WebappDir:      webappDir,
		DeploymentRoot: cbPlan.DeploymentRoot,
		ContextPath:    cbPlan.ContextPath,
		HTTPPort:       0,
		ShutdownPort:   0,
		DebugPort:      0,
		JVMOptions:     []string{},
		Env:            []string{},
		Generation:     generation,
	}

	return plan, nil
}

func (r *DefaultRuntimePlanResolver) ResolveDeploymentTarget(plan *domain.RuntimePlan) (domain.DeploymentTarget, error) {
	if plan == nil {
		return domain.DeploymentTarget{}, fmt.Errorf("plan is nil")
	}
	if string(plan.WorkspaceID) == "" {
		return domain.DeploymentTarget{}, fmt.Errorf("workspace id is required")
	}
	if string(plan.ProjectID) == "" {
		return domain.DeploymentTarget{}, fmt.Errorf("project id is required")
	}
	if string(plan.ServerID) == "" {
		return domain.DeploymentTarget{}, fmt.Errorf("server id is required")
	}
	if plan.DeploymentRoot == "" {
		return domain.DeploymentTarget{}, fmt.Errorf("deployment root is required")
	}

	expectedWebapps := filepath.Join(r.dataRoot, "runtime", "servers", string(plan.ServerID), "webapps")
	absDeploy, err := filepath.Abs(plan.DeploymentRoot)
	if err != nil {
		return domain.DeploymentTarget{}, fmt.Errorf("resolve deployment root: %w", err)
	}
	absExpected, err := filepath.Abs(expectedWebapps)
	if err != nil {
		return domain.DeploymentTarget{}, fmt.Errorf("resolve expected root: %w", err)
	}
	rel, err := filepath.Rel(absExpected, absDeploy)
	if err != nil || (rel != "." && !relIsUnder(rel)) {
		return domain.DeploymentTarget{}, fmt.Errorf("%w: deployment root %s is not owned by server %s",
			domain.ErrDeploymentTargetMismatch, plan.DeploymentRoot, plan.ServerID)
	}

	return domain.DeploymentTarget{
		WorkspaceID: plan.WorkspaceID,
		ProjectID:   plan.ProjectID,
		ServerID:    plan.ServerID,
		Root:        plan.DeploymentRoot,
		OwnerToken:  r.ownerTokenGen(),
	}, nil
}

func relIsUnder(rel string) bool {
	if rel == ".." {
		return false
	}
	sep := string(filepath.Separator)
	if len(rel) >= 2+len(sep) && rel[:2+len(sep)] == ".."+sep {
		return false
	}
	return true
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
