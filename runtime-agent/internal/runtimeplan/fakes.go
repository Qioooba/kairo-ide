package runtimeplan

import (
	"context"
	"encoding/base32"
	"fmt"
	"sync"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

var testEncoding = base32.NewEncoding("abcdefghijklmnopqrstuvwxyz234567").WithPadding(base32.NoPadding)

type FakeWorkspaceRepo struct {
	mu         sync.Mutex
	workspaces map[domain.WorkspaceID]domain.Workspace
}

func NewFakeWorkspaceRepo() *FakeWorkspaceRepo {
	return &FakeWorkspaceRepo{workspaces: make(map[domain.WorkspaceID]domain.Workspace)}
}

func (r *FakeWorkspaceRepo) Add(ws domain.Workspace) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.workspaces[ws.ID] = ws
}

func (r *FakeWorkspaceRepo) Get(ctx context.Context, id domain.WorkspaceID) (*domain.Workspace, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ws, ok := r.workspaces[id]
	if !ok {
		return nil, fmt.Errorf("%w: %s", domain.ErrWorkspaceNotFound, id)
	}
	cp := ws
	return &cp, nil
}

func (r *FakeWorkspaceRepo) List(ctx context.Context) ([]domain.Workspace, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]domain.Workspace, 0, len(r.workspaces))
	for _, ws := range r.workspaces {
		result = append(result, ws)
	}
	return result, nil
}

func (r *FakeWorkspaceRepo) Save(ctx context.Context, ws domain.Workspace) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.workspaces[ws.ID] = ws
	return nil
}

func (r *FakeWorkspaceRepo) Touch(ctx context.Context, id domain.WorkspaceID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.workspaces[id]; !ok {
		return fmt.Errorf("%w: %s", domain.ErrWorkspaceNotFound, id)
	}
	return nil
}

func (r *FakeWorkspaceRepo) Delete(ctx context.Context, id domain.WorkspaceID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.workspaces, id)
	return nil
}

type FakeProjectRepo struct {
	mu       sync.Mutex
	projects map[domain.WorkspaceID]map[domain.ProjectID]domain.Project
}

func NewFakeProjectRepo() *FakeProjectRepo {
	return &FakeProjectRepo{projects: make(map[domain.WorkspaceID]map[domain.ProjectID]domain.Project)}
}

func (r *FakeProjectRepo) Add(p domain.Project) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.projects[p.WorkspaceID]; !ok {
		r.projects[p.WorkspaceID] = make(map[domain.ProjectID]domain.Project)
	}
	r.projects[p.WorkspaceID][p.ID] = p
}

func (r *FakeProjectRepo) Get(ctx context.Context, ws domain.WorkspaceID, id domain.ProjectID) (*domain.Project, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	projs, ok := r.projects[ws]
	if !ok {
		return nil, fmt.Errorf("%w: %s/%s", domain.ErrProjectNotFound, ws, id)
	}
	p, ok := projs[id]
	if !ok {
		return nil, fmt.Errorf("%w: %s/%s", domain.ErrProjectNotFound, ws, id)
	}
	cp := p
	return &cp, nil
}

func (r *FakeProjectRepo) List(ctx context.Context, ws domain.WorkspaceID) ([]domain.Project, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	projs, ok := r.projects[ws]
	if !ok {
		return nil, nil
	}
	result := make([]domain.Project, 0, len(projs))
	for _, p := range projs {
		result = append(result, p)
	}
	return result, nil
}

func (r *FakeProjectRepo) Save(ctx context.Context, p domain.Project) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.projects[p.WorkspaceID]; !ok {
		r.projects[p.WorkspaceID] = make(map[domain.ProjectID]domain.Project)
	}
	r.projects[p.WorkspaceID][p.ID] = p
	return nil
}

func (r *FakeProjectRepo) Delete(ctx context.Context, ws domain.WorkspaceID, id domain.ProjectID) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if projs, ok := r.projects[ws]; ok {
		delete(projs, id)
	}
	return nil
}

func (r *FakeProjectRepo) FindByRoot(ctx context.Context, ws domain.WorkspaceID, root string) (*domain.Project, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	projs, ok := r.projects[ws]
	if !ok {
		return nil, domain.ErrProjectNotFound
	}
	for _, p := range projs {
		if p.Root == root {
			cp := p
			return &cp, nil
		}
	}
	return nil, domain.ErrProjectNotFound
}

type FakeToolchainRepo struct {
	mu         sync.Mutex
	toolchains map[string]domain.Toolchain
}

func NewFakeToolchainRepo() *FakeToolchainRepo {
	return &FakeToolchainRepo{toolchains: make(map[string]domain.Toolchain)}
}

func (r *FakeToolchainRepo) Add(tc domain.Toolchain) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.toolchains[tc.ID] = tc
}

func (r *FakeToolchainRepo) Get(ctx context.Context, id string) (*domain.Toolchain, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	tc, ok := r.toolchains[id]
	if !ok {
		return nil, fmt.Errorf("%w: %s", domain.ErrToolchainNotFound, id)
	}
	cp := tc
	return &cp, nil
}

func (r *FakeToolchainRepo) List(ctx context.Context) ([]domain.Toolchain, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]domain.Toolchain, 0, len(r.toolchains))
	for _, tc := range r.toolchains {
		result = append(result, tc)
	}
	return result, nil
}

func (r *FakeToolchainRepo) Save(ctx context.Context, tc domain.Toolchain) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.toolchains[tc.ID] = tc
	return nil
}

func (r *FakeToolchainRepo) FindByJavaHome(ctx context.Context, javaHome string) (*domain.Toolchain, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, tc := range r.toolchains {
		if tc.JavaHome == javaHome {
			cp := tc
			return &cp, nil
		}
	}
	return nil, domain.ErrToolchainNotFound
}

type FakeRuntimeRegistry struct {
	mu       sync.Mutex
	runtimes map[string]RuntimeInstallation
}

func NewFakeRuntimeRegistry() *FakeRuntimeRegistry {
	return &FakeRuntimeRegistry{runtimes: make(map[string]RuntimeInstallation)}
}

func (r *FakeRuntimeRegistry) Add(rt RuntimeInstallation) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runtimes[rt.ID] = rt
}

func (r *FakeRuntimeRegistry) Get(ctx context.Context, id string) (*RuntimeInstallation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	rt, ok := r.runtimes[id]
	if !ok {
		return nil, fmt.Errorf("%w: %s", domain.ErrRuntimeNotFound, id)
	}
	cp := rt
	return &cp, nil
}

func (r *FakeRuntimeRegistry) List(ctx context.Context) ([]RuntimeInstallation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	result := make([]RuntimeInstallation, 0, len(r.runtimes))
	for _, rt := range r.runtimes {
		result = append(result, rt)
	}
	return result, nil
}

type FakeIDGenerator struct {
	mu      sync.Mutex
	counter uint64
}

func NewFakeIDGenerator() *FakeIDGenerator {
	return &FakeIDGenerator{}
}

func (g *FakeIDGenerator) NewServerID() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.counter++
	var b [16]byte
	for i := 0; i < 16; i++ {
		b[i] = byte(g.counter >> (i * 4))
	}
	return "srv_" + testEncoding.EncodeToString(b[:]), nil
}

func (g *FakeIDGenerator) NewWorkspaceID() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.counter++
	var b [16]byte
	for i := 0; i < 16; i++ {
		b[i] = byte(g.counter >> (i * 4))
	}
	return "ws_" + testEncoding.EncodeToString(b[:]), nil
}

func (g *FakeIDGenerator) NewProjectID() (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.counter++
	var b [16]byte
	for i := 0; i < 16; i++ {
		b[i] = byte(g.counter >> (i * 4))
	}
	return "prj_" + testEncoding.EncodeToString(b[:]), nil
}
