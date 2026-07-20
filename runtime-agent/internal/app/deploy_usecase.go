package app

import (
	"context"
	"fmt"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/deploy"
	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/transport/events"
)

// StartDeployCommand is the typed command to start a deployment.
type StartDeployCommand struct {
	WorkspaceID domain.WorkspaceID
	ProjectID   domain.ProjectID
	BuildID     domain.BuildID
	Scope       DeployScope
}

// DeployUseCase handles deployment operations through the typed app layer.
// Scope mapping:
//
//	"webapp":    webappDir → WEB-INF
//	"classes":   build output → WEB-INF/classes
//	"resources": resource roots → WEB-INF/classes
//	"libs":      configured libs → WEB-INF/lib
//	"all":       all of the above
//
// Target is Kairo-created isolated CatalinaBase, not arbitrary client path.
type DeployUseCase struct {
	projectRepo  domain.ProjectRepository
	buildHistory domain.BuildHistoryRepository
	serverRepo   domain.ServerHistoryRepository
	deployEngine deploy.DeployEngine
	resolver     *PlanResolver
	eventHub     *events.EventHub
}

// NewDeployUseCase creates a new DeployUseCase.
func NewDeployUseCase(
	projectRepo domain.ProjectRepository,
	buildHistory domain.BuildHistoryRepository,
	serverRepo domain.ServerHistoryRepository,
	deployEngine deploy.DeployEngine,
	resolver *PlanResolver,
	eventHub *events.EventHub,
) *DeployUseCase {
	return &DeployUseCase{
		projectRepo:  projectRepo,
		buildHistory: buildHistory,
		serverRepo:   serverRepo,
		deployEngine: deployEngine,
		resolver:     resolver,
		eventHub:     eventHub,
	}
}

// DeployResult holds the result of a deployment operation.
type DeployResult struct {
	ID             string
	WorkspaceID    string
	ProjectID      string
	BuildID        string
	State          string
	Succeeded      int
	Failed         int
	Added          int
	Modified       int
	Deleted        int
	Bytes          int64
	FilesTouched   int
	Scope          string
	DeploymentRoot string
	Error          string
}

// Deploy resolves and executes a deployment.
func (uc *DeployUseCase) Deploy(ctx context.Context, cmd StartDeployCommand) (*DeployResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if cmd.WorkspaceID == "" {
		return nil, fmt.Errorf("%w: workspaceId is required", domain.ErrInvalidInput)
	}
	if cmd.ProjectID == "" {
		return nil, fmt.Errorf("%w: projectId is required", domain.ErrInvalidInput)
	}
	if cmd.BuildID == "" {
		return nil, fmt.Errorf("%w: buildId is required", domain.ErrInvalidInput)
	}

	project, err := uc.projectRepo.Get(ctx, cmd.WorkspaceID, cmd.ProjectID)
	if err != nil {
		return nil, fmt.Errorf("get project: %w", err)
	}

	// Set default scope
	scope := cmd.Scope
	if scope == "" {
		scope = DeployScopeAll
	}

	// Resolve the deploy plan
	plan, err := uc.resolver.ResolveDeploy(ctx, *project, cmd.BuildID)
	if err != nil {
		return nil, fmt.Errorf("resolve deploy plan: %w", err)
	}
	plan.Scope = scope

	// Find a running server for this project to get the deployment target
	servers, err := uc.serverRepo.ListByProject(ctx, cmd.WorkspaceID, cmd.ProjectID, 1)
	if err != nil {
		return nil, fmt.Errorf("list servers: %w", err)
	}

	var deploymentRoot string
	if len(servers) > 0 && servers[0] != nil && servers[0].RuntimePlan.DeploymentRoot != "" {
		deploymentRoot = servers[0].RuntimePlan.DeploymentRoot
	} else {
		// No running server; deployment target is not available
		return nil, fmt.Errorf("%w: no running server found for project %s, start a server first",
			domain.ErrInvalidInput, cmd.ProjectID)
	}

	plan.TargetDir = deploymentRoot

	// Build domain deploy plan from scope
	domainPlan, err := uc.buildDomainDeployPlan(cmd, scope, *plan)
	if err != nil {
		return nil, fmt.Errorf("build deploy plan: %w", err)
	}

	// Publish deploy.started event
	deployID := fmt.Sprintf("dep_%d", time.Now().UnixNano())
	uc.eventHub.Publish(events.Event{
		Type:        events.EventDeployStarted,
		WorkspaceID: string(cmd.WorkspaceID),
		Message:     fmt.Sprintf("Deployment %s started (scope=%s)", deployID, scope),
	})

	// Execute the deploy
	var deployResult *deploy.DeployResult
	if uc.deployEngine != nil {
		allowedSourceDirs := []string{plan.ProjectRoot}
		deployResult, err = uc.deployEngine.Execute(ctx, domainPlan, allowedSourceDirs)
	} else {
		// No engine — simulate
		deployResult = &deploy.DeployResult{
			Succeeded: 1,
		}
	}

	result := &DeployResult{
		ID:             deployID,
		WorkspaceID:    string(cmd.WorkspaceID),
		ProjectID:      string(cmd.ProjectID),
		BuildID:        string(cmd.BuildID),
		Scope:          string(scope),
		DeploymentRoot: deploymentRoot,
	}

	if err != nil {
		// Failed deployment must NOT leave "success" record
		result.State = "failed"
		result.Error = err.Error()
		uc.eventHub.Publish(events.Event{
			Type:        events.EventDeployComplete,
			WorkspaceID: string(cmd.WorkspaceID),
			Message:     fmt.Sprintf("Deployment %s failed: %v", deployID, err),
			Data:        result,
		})
		return result, err
	}

	if deployResult != nil {
		result.Succeeded = deployResult.Succeeded
		result.Failed = deployResult.Failed
		result.State = "success"
		if deployResult.Failed > 0 {
			result.State = "partial"
			result.Error = fmt.Sprintf("%d files failed to deploy", deployResult.Failed)
		}
	}

	// Track byte count from entries
	var totalBytes int64
	for _, entry := range domainPlan.Entries {
		totalBytes += entry.Size
	}
	result.Bytes = totalBytes
	result.FilesTouched = len(domainPlan.Entries)

	uc.eventHub.Publish(events.Event{
		Type:        events.EventDeployComplete,
		WorkspaceID: string(cmd.WorkspaceID),
		Message:     fmt.Sprintf("Deployment %s completed (%d files, %d bytes)", deployID, result.FilesTouched, result.Bytes),
		Data:        result,
	})

	return result, nil
}

// buildDomainDeployPlan creates a domain.DeployPlan from the resolved plan and scope.
func (uc *DeployUseCase) buildDomainDeployPlan(cmd StartDeployCommand, scope DeployScope, resolvedPlan DeployPlan) (domain.DeployPlan, error) {
	plan := domain.DeployPlan{
		WorkspaceID:    cmd.WorkspaceID,
		ProjectID:      cmd.ProjectID,
		BuildID:        cmd.BuildID,
		DeploymentRoot: resolvedPlan.TargetDir,
		Mode:           domain.DeployModeMerge,
	}

	// Scope: webapp → deployed webapp root
	// Scope: classes → WEB-INF/classes
	// Scope: resources → WEB-INF/classes
	// Scope: libs → WEB-INF/lib
	// Scope: all → everything

	switch scope {
	case DeployScopeWebapp:
		// Sync webapp directory to deployment root
		plan.Entries = append(plan.Entries, domain.DeployEntry{
			Source: resolvedPlan.WebappDir,
			Target: ".",
			Action: domain.DeployActionAdd,
		})
	case DeployScopeClasses:
		plan.Entries = append(plan.Entries, domain.DeployEntry{
			Source: resolvedPlan.OutputDir,
			Target: "WEB-INF/classes",
			Action: domain.DeployActionAdd,
		})
	case DeployScopeResources:
		for _, resRoot := range resolvedPlan.ResourceRoots {
			plan.Entries = append(plan.Entries, domain.DeployEntry{
				Source: resRoot,
				Target: "WEB-INF/classes",
				Action: domain.DeployActionAdd,
			})
		}
	case DeployScopeAll:
		// Classes → WEB-INF/classes
		plan.Entries = append(plan.Entries, domain.DeployEntry{
			Source: resolvedPlan.OutputDir,
			Target: "WEB-INF/classes",
			Action: domain.DeployActionAdd,
		})
		// Webapp → webapp root
		plan.Entries = append(plan.Entries, domain.DeployEntry{
			Source: resolvedPlan.WebappDir,
			Target: ".",
			Action: domain.DeployActionAdd,
		})
		// Resources → WEB-INF/classes
		for _, resRoot := range resolvedPlan.ResourceRoots {
			plan.Entries = append(plan.Entries, domain.DeployEntry{
				Source: resRoot,
				Target: "WEB-INF/classes",
				Action: domain.DeployActionAdd,
			})
		}
		// Libs → WEB-INF/lib
		for _, libDir := range resolvedPlan.LibDirs {
			plan.Entries = append(plan.Entries, domain.DeployEntry{
				Source: libDir,
				Target: "WEB-INF/lib",
				Action: domain.DeployActionAdd,
			})
		}
	default:
		return domain.DeployPlan{}, fmt.Errorf("%w: unknown deploy scope %s", domain.ErrInvalidInput, scope)
	}

	return plan, nil
}

// ListDeployments lists deployments for a project.
func (uc *DeployUseCase) ListDeployments(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) ([]*DeployResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// Deployments are not persisted separately — they are derived from build history
	// and server state. For now, return an empty list.
	return []*DeployResult{}, nil
}

// GetDeployment retrieves a deployment by ID.
func (uc *DeployUseCase) GetDeployment(ctx context.Context, workspaceID domain.WorkspaceID, deploymentID string) (*DeployResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// Deployments are currently ephemeral
	return nil, domain.ErrNotFound
}
