package repository

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

const workspacesFileName = "workspaces.json"

func workspacesFilePath(dataDir string) string {
	return filepath.Join(dataDir, "catalog", workspacesFileName)
}

func LoadWorkspaces(dataDir string) ([]domain.Workspace, error) {
	path := workspacesFilePath(dataDir)
	doc, err := ReadVersionedJSON[[]domain.Workspace](path)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.Workspace{}, nil
		}
		return nil, fmt.Errorf("read workspaces from %s: %w", path, err)
	}
	return doc.Data, nil
}

func SaveWorkspaces(dataDir string, workspaces []domain.Workspace) error {
	catalogDir := filepath.Join(dataDir, "catalog")
	if err := os.MkdirAll(catalogDir, 0755); err != nil {
		return fmt.Errorf("create catalog dir %s: %w", catalogDir, err)
	}
	path := workspacesFilePath(dataDir)
	doc := NewVersioned(workspaces)
	return AtomicWriteJSON(path, doc, 0644)
}

func TouchWorkspace(dataDir string, id domain.WorkspaceID) error {
	workspaces, err := LoadWorkspaces(dataDir)
	if err != nil {
		return fmt.Errorf("load workspaces: %w", err)
	}
	found := false
	now := domain.UTCNow()
	for i := range workspaces {
		if workspaces[i].ID == id {
			workspaces[i].LastOpened = now
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("workspace %s not found", id)
	}
	return SaveWorkspaces(dataDir, workspaces)
}
