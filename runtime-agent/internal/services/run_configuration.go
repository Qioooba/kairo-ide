package services

import (
	"context"
	"fmt"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/repository"
)

type diskRunConfigurationStore struct {
	workspaces *diskWorkspaceStore
	repository *repository.RunConfigurationRepository
}

func newDiskRunConfigurationStore(workspaces *diskWorkspaceStore) *diskRunConfigurationStore {
	return &diskRunConfigurationStore{
		workspaces: workspaces,
		repository: repository.NewRunConfigurationRepository(pathpolicy.NewDefaultPathPolicy()),
	}
}

func (store *diskRunConfigurationStore) workspaceRoot(workspaceID string) (string, error) {
	if err := pathpolicy.ValidateWorkspaceID(workspaceID); err != nil {
		return "", fmt.Errorf("invalid workspace id: %w", err)
	}
	workspace, err := store.workspaces.Get(workspaceID)
	if err != nil {
		return "", err
	}
	return workspace.RootPath, nil
}

func (store *diskRunConfigurationStore) Load(ctx context.Context, workspaceID string) (domain.RunConfigurationDocument, error) {
	root, err := store.workspaceRoot(workspaceID)
	if err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	return store.repository.Load(ctx, root)
}

func (store *diskRunConfigurationStore) Replace(ctx context.Context, workspaceID string, document domain.RunConfigurationDocument) (domain.RunConfigurationDocument, error) {
	root, err := store.workspaceRoot(workspaceID)
	if err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	return store.repository.Replace(ctx, root, document)
}

func (store *diskRunConfigurationStore) Get(ctx context.Context, workspaceID, configurationID string) (domain.TomcatRunConfiguration, error) {
	root, err := store.workspaceRoot(workspaceID)
	if err != nil {
		return domain.TomcatRunConfiguration{}, err
	}
	return store.repository.Get(ctx, root, configurationID)
}

func (store *diskRunConfigurationStore) Create(ctx context.Context, workspaceID string, configuration domain.TomcatRunConfiguration) (domain.RunConfigurationDocument, error) {
	root, err := store.workspaceRoot(workspaceID)
	if err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	return store.repository.Create(ctx, root, configuration)
}

func (store *diskRunConfigurationStore) Update(ctx context.Context, workspaceID, configurationID string, configuration domain.TomcatRunConfiguration) (domain.RunConfigurationDocument, error) {
	root, err := store.workspaceRoot(workspaceID)
	if err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	return store.repository.Update(ctx, root, configurationID, configuration)
}

func (store *diskRunConfigurationStore) Delete(ctx context.Context, workspaceID, configurationID string) (domain.RunConfigurationDocument, error) {
	root, err := store.workspaceRoot(workspaceID)
	if err != nil {
		return domain.RunConfigurationDocument{}, err
	}
	return store.repository.Delete(ctx, root, configurationID)
}
