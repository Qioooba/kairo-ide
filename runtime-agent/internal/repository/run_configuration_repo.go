package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
)

const (
	RunConfigurationsRelativePath = ".legacyflow/run-configurations.json"
	maxRunConfigurationsFileSize  = 2 << 20
)

var errRunConfigurationsTooLarge = errors.New("run configurations file is too large")

type RunConfigurationRepository struct {
	mu     sync.RWMutex
	policy pathpolicy.PathAuthorizer
}

func NewRunConfigurationRepository(policy pathpolicy.PathAuthorizer) *RunConfigurationRepository {
	if policy == nil {
		policy = pathpolicy.NewDefaultPathPolicy()
	}
	return &RunConfigurationRepository{policy: policy}
}

func (repository *RunConfigurationRepository) filePath(workspaceRoot string) (string, error) {
	path, err := repository.policy.ResolveWithin(workspaceRoot, RunConfigurationsRelativePath)
	if err != nil {
		return "", fmt.Errorf("resolve run configurations path: %w", err)
	}
	return path, nil
}

func readRunConfigurationsBounded(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxRunConfigurationsFileSize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxRunConfigurationsFileSize {
		return nil, fmt.Errorf("%w: exceeds %d bytes", errRunConfigurationsTooLarge, maxRunConfigurationsFileSize)
	}
	return data, nil
}

func (repository *RunConfigurationRepository) loadUnlocked(ctx context.Context, workspaceRoot string) (domain.RunConfigurationDocument, error) {
	if err := ctx.Err(); err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	path, err := repository.filePath(workspaceRoot)
	if err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	data, err := readRunConfigurationsBounded(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return domain.RunConfigurationDocument{}, domain.ErrRunConfigurationsMissing
		}
		if errors.Is(err, errRunConfigurationsTooLarge) {
			return domain.RunConfigurationDocument{}, fmt.Errorf("%w: %v", domain.ErrRunConfigurationsCorrupt, err)
		}
		return domain.RunConfigurationDocument{}, fmt.Errorf("read run configurations: %w", err)
	}
	document, err := domain.DecodeRunConfigurationDocument(data)
	if err != nil {
		return domain.RunConfigurationDocument{}, fmt.Errorf("%w: %v", domain.ErrRunConfigurationsCorrupt, err)
	}
	return document, nil
}

func (repository *RunConfigurationRepository) saveUnlocked(ctx context.Context, workspaceRoot string, document domain.RunConfigurationDocument) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := document.Validate(); err != nil {
		return err
	}
	path, err := repository.filePath(workspaceRoot)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal run configurations: %w", err)
	}
	data = append(data, '\n')
	if len(data) > maxRunConfigurationsFileSize {
		return fmt.Errorf("%w: serialized document exceeds %d bytes", domain.ErrInvalidRunConfiguration, maxRunConfigurationsFileSize)
	}
	if err := atomicfile.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("write run configurations: %w", err)
	}
	return nil
}

func (repository *RunConfigurationRepository) Load(ctx context.Context, workspaceRoot string) (domain.RunConfigurationDocument, error) {
	repository.mu.RLock()
	defer repository.mu.RUnlock()
	return repository.loadUnlocked(ctx, workspaceRoot)
}

func (repository *RunConfigurationRepository) Replace(ctx context.Context, workspaceRoot string, document domain.RunConfigurationDocument) (domain.RunConfigurationDocument, error) {
	repository.mu.Lock()
	defer repository.mu.Unlock()
	if err := repository.saveUnlocked(ctx, workspaceRoot, document); err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	return document, nil
}

func (repository *RunConfigurationRepository) Get(ctx context.Context, workspaceRoot, configurationID string) (domain.TomcatRunConfiguration, error) {
	if err := domain.ValidateRunConfigurationID(configurationID); err != nil {
		return domain.TomcatRunConfiguration{}, fmt.Errorf("%w: invalid id: %v", domain.ErrInvalidRunConfiguration, err)
	}
	repository.mu.RLock()
	defer repository.mu.RUnlock()
	document, err := repository.loadUnlocked(ctx, workspaceRoot)
	if err != nil {
		return domain.TomcatRunConfiguration{}, err
	}
	for _, configuration := range document.Configurations {
		if configuration.ID == configurationID {
			return configuration, nil
		}
	}
	return domain.TomcatRunConfiguration{}, domain.ErrRunConfigurationNotFound
}

func (repository *RunConfigurationRepository) Create(ctx context.Context, workspaceRoot string, configuration domain.TomcatRunConfiguration) (domain.RunConfigurationDocument, error) {
	if err := configuration.Validate(); err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	repository.mu.Lock()
	defer repository.mu.Unlock()
	document, err := repository.loadUnlocked(ctx, workspaceRoot)
	if errors.Is(err, domain.ErrRunConfigurationsMissing) {
		document = domain.RunConfigurationDocument{Version: domain.RunConfigurationVersion, Configurations: []domain.TomcatRunConfiguration{}}
	} else if err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	for _, existing := range document.Configurations {
		if existing.ID == configuration.ID || strings.EqualFold(existing.Name, configuration.Name) {
			return domain.RunConfigurationDocument{}, domain.ErrRunConfigurationConflict
		}
	}
	document.Configurations = append(document.Configurations, configuration)
	if document.SelectedConfigurationID == nil {
		selected := configuration.ID
		document.SelectedConfigurationID = &selected
	}
	if err := repository.saveUnlocked(ctx, workspaceRoot, document); err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	return document, nil
}

func (repository *RunConfigurationRepository) Update(ctx context.Context, workspaceRoot, configurationID string, configuration domain.TomcatRunConfiguration) (domain.RunConfigurationDocument, error) {
	if configuration.ID != configurationID {
		return domain.RunConfigurationDocument{}, fmt.Errorf("%w: path id must match body id", domain.ErrInvalidRunConfiguration)
	}
	if err := configuration.Validate(); err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	repository.mu.Lock()
	defer repository.mu.Unlock()
	document, err := repository.loadUnlocked(ctx, workspaceRoot)
	if err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	found := false
	for index, existing := range document.Configurations {
		if existing.ID == configurationID {
			document.Configurations[index] = configuration
			found = true
			continue
		}
		if strings.EqualFold(existing.Name, configuration.Name) {
			return domain.RunConfigurationDocument{}, domain.ErrRunConfigurationConflict
		}
	}
	if !found {
		return domain.RunConfigurationDocument{}, domain.ErrRunConfigurationNotFound
	}
	if err := repository.saveUnlocked(ctx, workspaceRoot, document); err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	return document, nil
}

func (repository *RunConfigurationRepository) Delete(ctx context.Context, workspaceRoot, configurationID string) (domain.RunConfigurationDocument, error) {
	if err := domain.ValidateRunConfigurationID(configurationID); err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	repository.mu.Lock()
	defer repository.mu.Unlock()
	document, err := repository.loadUnlocked(ctx, workspaceRoot)
	if err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	filtered := make([]domain.TomcatRunConfiguration, 0, len(document.Configurations))
	found := false
	for _, configuration := range document.Configurations {
		if configuration.ID == configurationID {
			found = true
			continue
		}
		filtered = append(filtered, configuration)
	}
	if !found {
		return domain.RunConfigurationDocument{}, domain.ErrRunConfigurationNotFound
	}
	document.Configurations = filtered
	if document.SelectedConfigurationID != nil && *document.SelectedConfigurationID == configurationID {
		if len(filtered) == 0 {
			document.SelectedConfigurationID = nil
		} else {
			selected := filtered[0].ID
			document.SelectedConfigurationID = &selected
		}
	}
	if err := repository.saveUnlocked(ctx, workspaceRoot, document); err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	return document, nil
}
