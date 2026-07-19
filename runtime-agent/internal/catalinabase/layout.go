package catalinabase

import (
	"os"
	"path/filepath"
)

type Layout struct {
	BaseDir    string
	ConfDir    string
	LogsDir    string
	TempDir    string
	WorkDir    string
	WebappsDir string
	StateDir   string
}

type Plan struct {
	Owner          OwnerMetadata
	Layout         Layout
	ContextPath    string
	DeploymentRoot string
	WebappDirName  string
}

func NewLayout(dataRoot string, serverID string) Layout {
	baseDir := filepath.Join(dataRoot, "runtime", "servers", serverID)
	return Layout{
		BaseDir:    baseDir,
		ConfDir:    filepath.Join(baseDir, confDir),
		LogsDir:    filepath.Join(baseDir, logsDir),
		TempDir:    filepath.Join(baseDir, tempDir),
		WorkDir:    filepath.Join(baseDir, workDir),
		WebappsDir: filepath.Join(baseDir, webappsDir),
		StateDir:   filepath.Join(baseDir, stateDir),
	}
}

func (l Layout) Exists() bool {
	_, err := os.Stat(l.BaseDir)
	return err == nil
}

func (l Layout) RequiredDirs() []string {
	return []string{
		l.BaseDir,
		l.ConfDir,
		l.LogsDir,
		l.TempDir,
		l.WorkDir,
		l.WebappsDir,
		l.StateDir,
	}
}
