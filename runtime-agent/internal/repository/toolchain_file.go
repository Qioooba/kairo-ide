package repository

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/kairo-ide/runtime-agent/internal/domain"
)

// toolchainsFileName is the file name for storing toolchain data.
const toolchainsFileName = "toolchains.json"

func toolchainsFilePath(dataDir string) string {
	return filepath.Join(dataDir, toolchainsFileName)
}

// LoadToolchains reads all toolchains from toolchains.json in the data directory.
func LoadToolchains(dataDir string) ([]domain.Toolchain, error) {
	path := toolchainsFilePath(dataDir)
	doc, err := ReadVersionedJSON[[]domain.Toolchain](path)
	if err != nil {
		if os.IsNotExist(err) {
			return []domain.Toolchain{}, nil
		}
		return nil, fmt.Errorf("read toolchains from %s: %w", path, err)
	}
	return doc.Data, nil
}

// SaveToolchains writes the toolchains slice atomically to toolchains.json.
func SaveToolchains(dataDir string, toolchains []domain.Toolchain) error {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return fmt.Errorf("create data dir %s: %w", dataDir, err)
	}
	path := toolchainsFilePath(dataDir)
	doc := NewVersioned(toolchains)
	return AtomicWriteJSON(path, doc, 0644)
}

// FindToolchainByJavaHome looks up a toolchain by its javaHome path.
func FindToolchainByJavaHome(dataDir string, javaHome string) (*domain.Toolchain, error) {
	toolchains, err := LoadToolchains(dataDir)
	if err != nil {
		return nil, fmt.Errorf("load toolchains: %w", err)
	}
	for i := range toolchains {
		if toolchains[i].JavaHome == javaHome {
			return &toolchains[i], nil
		}
	}
	return nil, fmt.Errorf("toolchain with javaHome %s not found", javaHome)
}