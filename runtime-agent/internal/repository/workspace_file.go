package repository

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// workspacesFileName is the file name for storing workspace data.
const workspacesFileName = "workspaces.json"

func workspacesFilePath(dataDir string) string {
	return filepath.Join(dataDir, workspacesFileName)
}

// LoadWorkspaces reads all workspaces from workspaces.json in the data directory.
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

// SaveWorkspaces writes the workspaces slice atomically to workspaces.json.
func SaveWorkspaces(dataDir string, workspaces []domain.Workspace) error {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return fmt.Errorf("create data dir %s: %w", dataDir, err)
	}
	path := workspacesFilePath(dataDir)
	doc := NewVersioned(workspaces)
	return AtomicWriteJSON(path, doc, 0644)
}

// TouchWorkspace updates the LastOpened timestamp for a workspace without holding a lock.
func TouchWorkspace(dataDir string, id domain.WorkspaceID) error {
	workspaces, err := LoadWorkspaces(dataDir)
	if err != nil {
		return fmt.Errorf("load workspaces: %w", err)
	}
	found := false
	for i := range workspaces {
		if workspaces[i].ID == id {
			workspaces[i].LastOpened = time.Now()
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("workspace %s not found", id)
	}
	return SaveWorkspaces(dataDir, workspaces)
}