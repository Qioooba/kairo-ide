package repository

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
)

func repositoryRunConfiguration(id string) domain.TomcatRunConfiguration {
	return domain.TomcatRunConfiguration{
		ID: id, Name: "Configuration " + id, Type: "tomcat6", ProjectID: "legacy-sample",
		Mode: "run", JDKRef: "jdk6-local", Build: domain.RunConfigurationBuild{Type: "ant", Target: "war"},
		Server: domain.RunConfigurationServer{ID: "tomcat6-local", HTTPPort: 18080, DebugPort: 8000, ContextPath: "/legacy"},
		Deploy: domain.RunConfigurationDeploy{Mode: "exploded", Artifact: "dist/legacy"},
		Env:    map[string]string{}, VMOptions: []string{}, BeforeLaunchTasks: []string{"build", "deploy"},
	}
}

func TestRunConfigurationRepositoryCRUDAndSelection(t *testing.T) {
	root := t.TempDir()
	repository := NewRunConfigurationRepository(nil)
	ctx := context.Background()
	if _, err := repository.Load(ctx, root); !errors.Is(err, domain.ErrRunConfigurationsMissing) {
		t.Fatalf("missing load: %v", err)
	}
	first := repositoryRunConfiguration("first")
	document, err := repository.Create(ctx, root, first)
	if err != nil {
		t.Fatal(err)
	}
	if document.SelectedConfigurationID == nil || *document.SelectedConfigurationID != "first" {
		t.Fatalf("first create selection: %#v", document.SelectedConfigurationID)
	}
	second := repositoryRunConfiguration("second")
	if _, err := repository.Create(ctx, root, second); err != nil {
		t.Fatal(err)
	}
	second.Name = "Updated second"
	if _, err := repository.Update(ctx, root, "different", second); !errors.Is(err, domain.ErrInvalidRunConfiguration) {
		t.Fatalf("mismatched id: %v", err)
	}
	if _, err := repository.Update(ctx, root, second.ID, second); err != nil {
		t.Fatal(err)
	}
	loaded, err := repository.Get(ctx, root, second.ID)
	if err != nil || loaded.Name != second.Name {
		t.Fatalf("get updated: %#v, %v", loaded, err)
	}
	document, err = repository.Delete(ctx, root, "first")
	if err != nil {
		t.Fatal(err)
	}
	if document.SelectedConfigurationID == nil || *document.SelectedConfigurationID != "second" {
		t.Fatalf("delete selected must select first remaining: %#v", document.SelectedConfigurationID)
	}
	document, err = repository.Delete(ctx, root, "second")
	if err != nil {
		t.Fatal(err)
	}
	if document.SelectedConfigurationID != nil || len(document.Configurations) != 0 {
		t.Fatalf("delete last must select null: %#v", document)
	}

	path := filepath.Join(root, filepath.FromSlash(RunConfigurationsRelativePath))
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o, want 600", info.Mode().Perm())
	}
}

func TestRunConfigurationRepositoryCorruptFileIsNotOverwrittenByMutation(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, filepath.FromSlash(RunConfigurationsRelativePath))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	original := []byte(`{"version":1,"configurations":`)
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	repository := NewRunConfigurationRepository(nil)
	if _, err := repository.Create(context.Background(), root, repositoryRunConfiguration("new")); !errors.Is(err, domain.ErrRunConfigurationsCorrupt) {
		t.Fatalf("expected corrupt error, got %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(original) {
		t.Fatal("corrupt file was overwritten")
	}
}

func TestRunConfigurationRepositoryOversizedFileIsCorrupt(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, filepath.FromSlash(RunConfigurationsRelativePath))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, maxRunConfigurationsFileSize+1), 0o600); err != nil {
		t.Fatal(err)
	}
	repository := NewRunConfigurationRepository(nil)
	if _, err := repository.Load(context.Background(), root); !errors.Is(err, domain.ErrRunConfigurationsCorrupt) {
		t.Fatalf("expected corrupt for oversized file, got %v", err)
	}
}

func largeRepositoryRunConfiguration(id string) domain.TomcatRunConfiguration {
	configuration := repositoryRunConfiguration(id)
	configuration.Env = make(map[string]string, 128)
	largeValue := strings.Repeat("x", 8192)
	for variable := 0; variable < 128; variable++ {
		configuration.Env[fmt.Sprintf("VALUE_%03d", variable)] = largeValue
	}
	return configuration
}

func readRunConfigurationFile(t *testing.T, root string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(RunConfigurationsRelativePath)))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestRunConfigurationRepositoryOversizedReplaceDoesNotOverwrite(t *testing.T) {
	root := t.TempDir()
	repository := NewRunConfigurationRepository(nil)
	ctx := context.Background()
	if _, err := repository.Create(ctx, root, repositoryRunConfiguration("original")); err != nil {
		t.Fatal(err)
	}
	original := readRunConfigurationFile(t, root)
	configurations := []domain.TomcatRunConfiguration{
		largeRepositoryRunConfiguration("large-0"),
		largeRepositoryRunConfiguration("large-1"),
		largeRepositoryRunConfiguration("large-2"),
	}
	selected := configurations[0].ID
	document := domain.RunConfigurationDocument{Version: 1, Configurations: configurations, SelectedConfigurationID: &selected}
	if _, err := repository.Replace(ctx, root, document); !errors.Is(err, domain.ErrInvalidRunConfiguration) {
		t.Fatalf("expected invalid oversized replace, got %v", err)
	}
	if after := readRunConfigurationFile(t, root); string(after) != string(original) {
		t.Fatal("oversized replace changed original file")
	}
}

func TestRunConfigurationRepositoryOversizedCreateAndUpdateDoNotOverwrite(t *testing.T) {
	t.Run("create", func(t *testing.T) {
		root := t.TempDir()
		repository := NewRunConfigurationRepository(nil)
		ctx := context.Background()
		if _, err := repository.Create(ctx, root, largeRepositoryRunConfiguration("large-0")); err != nil {
			t.Fatal(err)
		}
		original := readRunConfigurationFile(t, root)
		if _, err := repository.Create(ctx, root, largeRepositoryRunConfiguration("large-1")); !errors.Is(err, domain.ErrInvalidRunConfiguration) {
			t.Fatalf("expected invalid oversized create, got %v", err)
		}
		if after := readRunConfigurationFile(t, root); string(after) != string(original) {
			t.Fatal("oversized create changed original file")
		}
	})
	t.Run("update", func(t *testing.T) {
		root := t.TempDir()
		repository := NewRunConfigurationRepository(nil)
		ctx := context.Background()
		if _, err := repository.Create(ctx, root, largeRepositoryRunConfiguration("large-0")); err != nil {
			t.Fatal(err)
		}
		if _, err := repository.Create(ctx, root, repositoryRunConfiguration("small")); err != nil {
			t.Fatal(err)
		}
		original := readRunConfigurationFile(t, root)
		if _, err := repository.Update(ctx, root, "small", largeRepositoryRunConfiguration("small")); !errors.Is(err, domain.ErrInvalidRunConfiguration) {
			t.Fatalf("expected invalid oversized update, got %v", err)
		}
		if after := readRunConfigurationFile(t, root); string(after) != string(original) {
			t.Fatal("oversized update changed original file")
		}
	})
}

func TestRunConfigurationRepositoryConcurrentCreatesAreLossless(t *testing.T) {
	root := t.TempDir()
	repository := NewRunConfigurationRepository(nil)
	ctx := context.Background()
	const count = 40
	var wg sync.WaitGroup
	errorsSeen := make(chan error, count)
	for index := 0; index < count; index++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			_, err := repository.Create(ctx, root, repositoryRunConfiguration(fmt.Sprintf("run-%02d", index)))
			errorsSeen <- err
		}(index)
	}
	wg.Wait()
	close(errorsSeen)
	for err := range errorsSeen {
		if err != nil {
			t.Fatalf("concurrent create: %v", err)
		}
	}
	document, err := repository.Load(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if len(document.Configurations) != count {
		t.Fatalf("configurations = %d, want %d", len(document.Configurations), count)
	}
}

func TestRunConfigurationRepositoryRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation is privilege-dependent on Windows")
	}
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, ".legacyflow")); err != nil {
		t.Fatal(err)
	}
	repository := NewRunConfigurationRepository(pathpolicy.NewDefaultPathPolicy())
	_, err := repository.Create(context.Background(), root, repositoryRunConfiguration("escape"))
	if !errors.Is(err, pathpolicy.ErrSymlinkEscape) {
		t.Fatalf("expected symlink escape, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(outside, "run-configurations.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("outside file exists: %v", err)
	}
}
