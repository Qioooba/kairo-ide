package repository

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
)

const projectsFileName = "projects.json"

type ProjectRecord struct {
	WorkspaceID domain.WorkspaceID `json:"workspaceId"`
	ProjectID   domain.ProjectID   `json:"projectId"`
	Root        string             `json:"root"`
	CreatedAt   time.Time          `json:"createdAt"`
	UpdatedAt   time.Time          `json:"updatedAt"`
}

type projectCatalogData struct {
	Records []ProjectRecord `json:"records"`
}

type ProjectCatalog struct {
	mu      sync.Mutex
	dataDir string
	policy  pathpolicy.PathAuthorizer
}

func NewProjectCatalog(dataDir string, policy pathpolicy.PathAuthorizer) *ProjectCatalog {
	if policy == nil {
		policy = pathpolicy.NewDefaultPathPolicy()
	}
	return &ProjectCatalog{dataDir: dataDir, policy: policy}
}

func (c *ProjectCatalog) catalogDir() string {
	return filepath.Join(c.dataDir, "catalog")
}

func (c *ProjectCatalog) filePath() string {
	return filepath.Join(c.catalogDir(), projectsFileName)
}

func (c *ProjectCatalog) load() (*projectCatalogData, error) {
	path := c.filePath()
	doc, err := ReadVersionedJSON[projectCatalogData](path)
	if err != nil {
		if os.IsNotExist(err) {
			return &projectCatalogData{Records: []ProjectRecord{}}, nil
		}
		return nil, fmt.Errorf("read project catalog from %s: %w", path, err)
	}
	return &doc.Data, nil
}

func (c *ProjectCatalog) save(data *projectCatalogData) error {
	if err := os.MkdirAll(c.catalogDir(), 0755); err != nil {
		return fmt.Errorf("create catalog dir %s: %w", c.catalogDir(), err)
	}
	doc := NewVersioned(*data)
	return AtomicWriteJSON(c.filePath(), doc, 0644)
}

func (c *ProjectCatalog) validateRecord(record ProjectRecord) error {
	if err := pathpolicy.ValidateWorkspaceID(string(record.WorkspaceID)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(record.ProjectID)); err != nil {
		return fmt.Errorf("invalid project id: %w", err)
	}
	if record.Root == "" {
		record.Root = "."
	}
	if err := c.policy.ValidateRelativeConfigPath(record.Root, false); err != nil {
		return fmt.Errorf("invalid project root %q: %w", record.Root, err)
	}
	return nil
}

func cloneProjectRecord(r ProjectRecord) ProjectRecord {
	return ProjectRecord{
		WorkspaceID: r.WorkspaceID,
		ProjectID:   r.ProjectID,
		Root:        r.Root,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

func (c *ProjectCatalog) ListByWorkspace(ctx context.Context, workspaceID domain.WorkspaceID) ([]ProjectRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := c.load()
	if err != nil {
		return nil, err
	}
	var result []ProjectRecord
	for _, r := range data.Records {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if r.WorkspaceID == workspaceID {
			result = append(result, cloneProjectRecord(r))
		}
	}
	return result, nil
}

func (c *ProjectCatalog) Get(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) (*ProjectRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(projectID)); err != nil {
		return nil, fmt.Errorf("invalid project id: %w", err)
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := c.load()
	if err != nil {
		return nil, err
	}
	for _, r := range data.Records {
		if r.WorkspaceID == workspaceID && r.ProjectID == projectID {
			rec := cloneProjectRecord(r)
			return &rec, nil
		}
	}
	return nil, domain.ErrProjectNotFound
}

func (c *ProjectCatalog) FindByRoot(ctx context.Context, workspaceID domain.WorkspaceID, root string) (*ProjectRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if root == "" {
		root = "."
	}
	if err := c.policy.ValidateRelativeConfigPath(root, false); err != nil {
		return nil, fmt.Errorf("invalid root path %q: %w", root, err)
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := c.load()
	if err != nil {
		return nil, err
	}
	for _, r := range data.Records {
		if r.WorkspaceID == workspaceID && r.Root == root {
			rec := cloneProjectRecord(r)
			return &rec, nil
		}
	}
	return nil, domain.ErrProjectNotFound
}

func (c *ProjectCatalog) Put(ctx context.Context, record ProjectRecord) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if record.Root == "" {
		record.Root = "."
	}
	if err := c.validateRecord(record); err != nil {
		return err
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := c.load()
	if err != nil {
		return err
	}

	now := domain.UTCNow()
	found := false
	for i := range data.Records {
		if data.Records[i].WorkspaceID == record.WorkspaceID && data.Records[i].ProjectID == record.ProjectID {
			data.Records[i].Root = record.Root
			data.Records[i].UpdatedAt = now
			if data.Records[i].CreatedAt.IsZero() {
				data.Records[i].CreatedAt = now
			}
			found = true
		} else if data.Records[i].WorkspaceID == record.WorkspaceID && data.Records[i].Root == record.Root {
			return fmt.Errorf("%w: project id %s already uses root %q in workspace %s",
				domain.ErrDuplicateRoot, data.Records[i].ProjectID, record.Root, record.WorkspaceID)
		}
	}
	if !found {
		for i := range data.Records {
			if data.Records[i].WorkspaceID == record.WorkspaceID && data.Records[i].Root == record.Root {
				return fmt.Errorf("%w: root %q already registered in workspace %s",
					domain.ErrDuplicateRoot, record.Root, record.WorkspaceID)
			}
		}
		if record.CreatedAt.IsZero() {
			record.CreatedAt = now
		}
		record.UpdatedAt = now
		data.Records = append(data.Records, record)
	}

	return c.save(data)
}

func (c *ProjectCatalog) Delete(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(projectID)); err != nil {
		return fmt.Errorf("invalid project id: %w", err)
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	data, err := c.load()
	if err != nil {
		return err
	}

	filtered := make([]ProjectRecord, 0, len(data.Records))
	found := false
	for _, r := range data.Records {
		if r.WorkspaceID == workspaceID && r.ProjectID == projectID {
			found = true
			continue
		}
		filtered = append(filtered, r)
	}
	if !found {
		return domain.ErrProjectNotFound
	}

	return c.save(&projectCatalogData{Records: filtered})
}
