package catalinabase

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

const (
	ownerFileName = "owner.json"
	SchemaVersion = 1
	confDir       = "conf"
	logsDir       = "logs"
	tempDir       = "temp"
	workDir       = "work"
	webappsDir    = "webapps"
	stateDir      = "state"
)

type OwnerMetadata struct {
	WorkspaceID   domain.WorkspaceID `json:"workspaceId"`
	ProjectID     domain.ProjectID   `json:"projectId"`
	ServerID      domain.ServerID    `json:"serverId"`
	RuntimeID     string             `json:"runtimeId"`
	SchemaVersion int                `json:"schemaVersion"`
	CreatedAt     time.Time          `json:"createdAt"`
}

func (m OwnerMetadata) Matches(other OwnerMetadata) bool {
	return m.WorkspaceID == other.WorkspaceID &&
		m.ProjectID == other.ProjectID &&
		m.ServerID == other.ServerID &&
		m.RuntimeID == other.RuntimeID
}

func ownerPath(baseDir string) string {
	return filepath.Join(baseDir, ownerFileName)
}

func ReadOwner(baseDir string) (*OwnerMetadata, error) {
	path := ownerPath(baseDir)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var meta OwnerMetadata
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, fmt.Errorf("parse owner.json: %w", err)
	}
	return &meta, nil
}

func WriteOwner(baseDir string, meta OwnerMetadata) error {
	if meta.SchemaVersion == 0 {
		meta.SchemaVersion = SchemaVersion
	}
	if meta.CreatedAt.IsZero() {
		meta.CreatedAt = time.Now().UTC()
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal owner: %w", err)
	}
	path := ownerPath(baseDir)
	return atomicfile.WriteFile(path, data, 0644)
}

func VerifyOwner(baseDir string, expected OwnerMetadata) error {
	existing, err := ReadOwner(baseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if existing.SchemaVersion != expected.SchemaVersion && expected.SchemaVersion != 0 {
		return fmt.Errorf("%w: schema version mismatch (got %d, want %d)",
			domain.ErrDeploymentTargetMismatch, existing.SchemaVersion, expected.SchemaVersion)
	}
	if !existing.Matches(expected) {
		return fmt.Errorf("%w: server %s owner mismatch (existing ws=%s project=%s runtime=%s)",
			domain.ErrDeploymentTargetMismatch,
			expected.ServerID,
			existing.WorkspaceID, existing.ProjectID, existing.RuntimeID)
	}
	return nil
}
