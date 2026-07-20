package services

import (
	"os/exec"
	"path/filepath"
	"strconv"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/log"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/tomcat6"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/toolchain"
)

const (
	srvRunning  = "running"
	srvStarting = "starting"
	srvStopping = "stopping"
	srvStopped  = "stopped"
	srvError    = "error"
	srvCrashed  = "crashed"
)

// Config bundles the data directory, bundled directory, and a
// logger for the service factory.
type Config struct {
	DataDir       string
	BundledDir    string
	Logger        *log.Logger
	Tomcat6Home   string
	SkipSHAVerify bool
	JDTLSURL      string
}

// NewMemoryServices returns a fully-wired Services struct with
// real implementations. The sandbox is enforced by services that
// accept caller-supplied paths (encoder, searcher, deployer, …);
// previously it was passed in but never stored, leaving every
// path-accepting endpoint able to read/write arbitrary files.
func NewMemoryServices(cfg Config, sandbox *security.WorkspaceRoots) *api.Services {
	registry, _ := toolchain.NewRegistry(filepath.Join(cfg.DataDir, "toolchains"))
	tomcat6Home := cfg.Tomcat6Home
	if tomcat6Home == "" {
		home, err := tomcat6.FetchCatalinaHomeOrDownload(cfg.BundledDir)
		if err == nil {
			tomcat6Home = home
		} else {
			cfg.Logger.Warn("tomcat6 not available", log.Fields{"err": err.Error()})
		}
	}
	return &api.Services{
		WorkspaceStore:      newDiskWorkspaceStore(cfg.DataDir, sandbox),
		ProjectStore:        newDiskProjectStore(cfg.DataDir),
		ToolchainRegistry:   &memToolchainRegistry{reg: registry},
		ProjectRepo:         &domainProjectRepo{store: newDiskProjectStore(cfg.DataDir)},
		ToolchainRepo:       &domainToolchainRepo{reg: registry},
		Searcher:            &memSearcher{sandbox: sandbox},
		Encoder:             &memEncoder{sandbox: sandbox},
		BuildEngine:         newAsyncBuildEngine(cfg.DataDir, registry, cfg.Logger),
		Deployer:            newDiskDeployer(cfg.DataDir, cfg.Logger),
		ServerRunner:        newRealServerRunner(cfg.DataDir, cfg.BundledDir, tomcat6Home, cfg.Logger),
		Auth:                newDiskAuthenticator(cfg.DataDir, cfg.Logger),
		JDTLS:               newJDTLSService(cfg.DataDir, cfg.BundledDir, cfg.Logger, cfg.SkipSHAVerify, cfg.JDTLSURL),
		JDTProjectGenerator: newJDTProjectService(cfg.DataDir, cfg.BundledDir, cfg.Logger),
		// EventBus is wired in cmd/kairo-runtime/main.go after
		// bootstrap returns (we need the EventHub reference).
		// Leaving it nil here is safe — handleEvents will return
		// 500 until main.go sets it; the production main wires
		// it before ListenAndServe.
	}
}

var _ = exec.Command
var _ = strconv.Itoa