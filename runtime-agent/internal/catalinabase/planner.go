package catalinabase

import (
	"fmt"
	"path"
	"path/filepath"
	"strings"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

type Planner interface {
	Plan(dataRoot string, owner OwnerMetadata, contextPath string) (*Plan, error)
}

type Preparer interface {
	Prepare(plan *Plan) error
}

type DefaultPlanner struct{}

func NewDefaultPlanner() *DefaultPlanner {
	return &DefaultPlanner{}
}

func (p *DefaultPlanner) Plan(dataRoot string, owner OwnerMetadata, contextPath string) (*Plan, error) {
	if dataRoot == "" {
		return nil, fmt.Errorf("data root is required")
	}
	if string(owner.ServerID) == "" {
		return nil, fmt.Errorf("server id is required")
	}
	if string(owner.WorkspaceID) == "" {
		return nil, fmt.Errorf("workspace id is required")
	}
	if string(owner.ProjectID) == "" {
		return nil, fmt.Errorf("project id is required")
	}
	if owner.RuntimeID == "" {
		return nil, fmt.Errorf("runtime id is required")
	}

	normalizedContext, webappName, err := NormalizeContextPath(contextPath)
	if err != nil {
		return nil, err
	}

	layout := NewLayout(dataRoot, string(owner.ServerID))

	return &Plan{
		Owner:          owner,
		Layout:         layout,
		ContextPath:    normalizedContext,
		DeploymentRoot: filepath.Join(layout.WebappsDir, webappName),
		WebappDirName:  webappName,
	}, nil
}

func NormalizeContextPath(contextPath string) (normalized string, webappDirName string, err error) {
	if contextPath == "" || contextPath == "/" {
		return "/", "ROOT", nil
	}

	contextPath = strings.ReplaceAll(contextPath, "\\", "/")

	if !strings.HasPrefix(contextPath, "/") {
		contextPath = "/" + contextPath
	}

	if strings.Contains(contextPath, "..") {
		return "", "", fmt.Errorf("%w: context path contains traversal", domain.ErrInvalidConfig)
	}

	cleaned := path.Clean(contextPath)
	if cleaned == "/" {
		return "/", "ROOT", nil
	}

	if strings.Contains(cleaned, "..") {
		return "", "", fmt.Errorf("%w: context path contains traversal", domain.ErrInvalidConfig)
	}

	trimmed := strings.TrimPrefix(cleaned, "/")
	trimmed = strings.TrimSuffix(trimmed, "/")

	if err := validateContextName(trimmed); err != nil {
		return "", "", err
	}

	if !strings.HasPrefix(cleaned, "/") {
		cleaned = "/" + cleaned
	}

	return cleaned, trimmed, nil
}

func validateContextName(name string) error {
	if name == "" {
		return fmt.Errorf("%w: context path is empty", domain.ErrInvalidConfig)
	}
	if strings.ContainsAny(name, `\:`) {
		return fmt.Errorf("%w: context path contains invalid characters", domain.ErrInvalidConfig)
	}
	parts := strings.Split(name, "/")
	for _, part := range parts {
		if part == "" {
			return fmt.Errorf("%w: context path contains empty segment", domain.ErrInvalidConfig)
		}
		if strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return fmt.Errorf("%w: context path segment cannot end with dot or space", domain.ErrInvalidConfig)
		}
		reserved := []string{"CON", "PRN", "AUX", "NUL",
			"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
			"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"}
		upper := strings.ToUpper(part)
		for _, r := range reserved {
			if upper == r {
				return fmt.Errorf("%w: context path uses reserved name %s", domain.ErrInvalidConfig, part)
			}
		}
	}
	return nil
}
