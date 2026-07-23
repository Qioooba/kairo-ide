package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/pathpolicy"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/toolchain"
)

// ----------------- WorkspaceStore (disk) -----------------

type diskWorkspaceStore struct {
	mu      sync.Mutex
	dir     string
	data    map[string]api.WorkspaceRecord
	sandbox *security.WorkspaceRoots
}

func newDiskWorkspaceStore(dataDir string, sandbox *security.WorkspaceRoots) *diskWorkspaceStore {
	dir := filepath.Join(dataDir, "workspaces")
	_ = os.MkdirAll(dir, 0o755)
	ws := &diskWorkspaceStore{dir: dir, data: map[string]api.WorkspaceRecord{}, sandbox: sandbox}
	ws.load()
	return ws
}

func (s *diskWorkspaceStore) load() {
	p := filepath.Join(s.dir, "workspaces.json")
	data, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var items []api.WorkspaceRecord
	if err := json.Unmarshal(data, &items); err != nil {
		return
	}
	for _, w := range items {
		s.data[w.ID] = w
		// Re-register every persisted workspace's root path
		// with the sandbox. Without this, restarting the agent
		// would clear the in-memory sandbox roots while the
		// workspace records survive on disk — so the user would
		// see "path is outside any authorized workspace root"
		// for every file operation on a previously-opened
		// workspace, even though the workspace is in the list.
		if s.sandbox != nil && w.RootPath != "" {
			if err := s.sandbox.AddRoot(w.RootPath); err != nil {
				// Log and continue; the next Open will retry.
				fmt.Fprintf(os.Stderr, "sandbox.AddRoot(%q): %v\n", w.RootPath, err)
			}
		}
	}
}

func (s *diskWorkspaceStore) save() {
	items := make([]api.WorkspaceRecord, 0, len(s.data))
	for _, w := range s.data {
		items = append(items, w)
	}
	data, _ := json.MarshalIndent(items, "", "  ")
	_ = atomicfile.WriteFile(filepath.Join(s.dir, "workspaces.json"), data, 0o600)
}

func (s *diskWorkspaceStore) List() []api.WorkspaceRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]api.WorkspaceRecord, 0, len(s.data))
	for _, w := range s.data {
		out = append(out, w)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastOpened > out[j].LastOpened })
	return out
}

func (s *diskWorkspaceStore) Open(rootPath, name string) (api.WorkspaceRecord, error) {
	abs, err := filepath.Abs(rootPath)
	if err != nil {
		return api.WorkspaceRecord{}, err
	}
	if _, err := os.Stat(abs); err != nil {
		return api.WorkspaceRecord{}, fmt.Errorf("path not accessible: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if workspace with this root path already exists
	for _, w := range s.data {
		if w.RootPath == abs {
			// Update last opened time
			w.LastOpened = time.Now().UTC().Format(time.RFC3339Nano)
			s.data[w.ID] = w
			s.save()
			return w, nil
		}
	}

	// Register the new workspace root with the sandbox so that
	// subsequent file operations inside it pass authorization.
	if s.sandbox != nil {
		if err := s.sandbox.AddRoot(abs); err != nil {
			return api.WorkspaceRecord{}, fmt.Errorf("authorize workspace root: %w", err)
		}
	}

	idGen := pathpolicy.NewCryptoIDGenerator()
	id, err := idGen.NewWorkspaceID()
	if err != nil {
		return api.WorkspaceRecord{}, fmt.Errorf("generate workspace id: %w", err)
	}
	if name == "" {
		name = filepath.Base(abs)
	}
	w := api.WorkspaceRecord{
		ID:         id,
		Name:       name,
		RootPath:   abs,
		CreatedAt:  time.Now().UTC().Format(time.RFC3339Nano),
		LastOpened: time.Now().UTC().Format(time.RFC3339Nano),
		UserID:     "local",
	}
	s.data[id] = w
	s.save()
	return w, nil
}

func (s *diskWorkspaceStore) Get(id string) (api.WorkspaceRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, ok := s.data[id]
	if !ok {
		return api.WorkspaceRecord{}, fmt.Errorf("workspace not found: %s", id)
	}
	w.LastOpened = time.Now().UTC().Format(time.RFC3339Nano)
	s.data[id] = w
	s.save()
	return w, nil
}

func (s *diskWorkspaceStore) Close(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.data, id)
	s.save()
	return nil
}

// ----------------- ProjectStore (disk) -----------------

type diskProjectStore struct {
	mu   sync.Mutex
	dir  string
	data map[string]domain.Project
}

func newDiskProjectStore(dataDir string) *diskProjectStore {
	dir := filepath.Join(dataDir, "projects")
	_ = os.MkdirAll(dir, 0o755)
	ps := &diskProjectStore{dir: dir, data: map[string]domain.Project{}}
	ps.load()
	return ps
}

func (s *diskProjectStore) load() {
	p := filepath.Join(s.dir, "projects.json")
	data, err := os.ReadFile(p)
	if err != nil {
		return
	}
	var items map[string]domain.Project
	if err := json.Unmarshal(data, &items); err != nil {
		return
	}
	for k, v := range items {
		s.data[k] = v
	}
}

func (s *diskProjectStore) save() {
	_ = s.saveChecked()
}

func (s *diskProjectStore) saveChecked() error {
	data, _ := json.MarshalIndent(s.data, "", "  ")
	return atomicfile.WriteFile(filepath.Join(s.dir, "projects.json"), data, 0o600)
}

// Create is the create-only import boundary. It never overwrites an existing
// ID or canonical project root and rolls back the in-memory entry on I/O error.
func (s *diskProjectStore) Create(id string, cfg *domain.Project) (domain.Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cfg == nil || id == "" || string(cfg.ID) != id {
		return domain.Project{}, errors.New("project id mismatch")
	}
	if _, exists := s.data[id]; exists {
		return domain.Project{}, fmt.Errorf("project already exists: %s", id)
	}
	for _, existing := range s.data {
		if existing.RootPath == cfg.RootPath {
			return domain.Project{}, fmt.Errorf("project root already imported")
		}
	}
	s.data[id] = *cfg
	if err := s.saveChecked(); err != nil {
		delete(s.data, id)
		return domain.Project{}, err
	}
	return *cfg, nil
}

func (s *diskProjectStore) List() []domain.Project {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]domain.Project, 0, len(s.data))
	for _, p := range s.data {
		out = append(out, p)
	}
	return out
}

func (s *diskProjectStore) Get(id string) (domain.Project, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.data[id]
	if !ok {
		return domain.Project{}, fmt.Errorf("project not found: %s", id)
	}
	return p, nil
}

func (s *diskProjectStore) Update(id string, cfg *domain.Project) (domain.Project, error) {
	s.mu.Lock()
	s.data[id] = *cfg
	s.save()
	s.mu.Unlock()
	return *cfg, nil
}

// ----------------- ToolchainRegistry -----------------

type memToolchainRegistry struct {
	reg *toolchain.Registry
}

func (m *memToolchainRegistry) List() []json.RawMessage {
	out := []json.RawMessage{}
	for _, t := range m.reg.List() {
		b, _ := json.Marshal(t)
		out = append(out, b)
	}
	return out
}

func (m *memToolchainRegistry) Import(path, label string) (json.RawMessage, error) {
	t, err := toolchain.Detect(path)
	if err != nil {
		return nil, err
	}
	if label != "" {
		t.Vendor = label + " (" + t.Vendor + ")"
	}
	if err := m.reg.Add(t); err != nil {
		return nil, err
	}
	return json.Marshal(t)
}

// ----------------- helpers -----------------

func shortID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// domainProjectRepo adapts diskProjectStore to api.ProjectRepo.
type domainProjectRepo struct {
	store *diskProjectStore
}

func (r *domainProjectRepo) Get(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID) (*domain.Project, error) {
	p, err := r.store.Get(string(projectID))
	if err != nil {
		return nil, err
	}
	if p.WorkspaceID != workspaceID {
		return nil, fmt.Errorf("project %s belongs to workspace %s, not %s", projectID, p.WorkspaceID, workspaceID)
	}
	return &p, nil
}

// domainToolchainRepo adapts toolchain.Registry to api.ToolchainRepo.
type domainToolchainRepo struct {
	reg *toolchain.Registry
}

func (r *domainToolchainRepo) Get(ctx context.Context, id string) (*domain.Toolchain, error) {
	tc, ok := r.reg.Get(id)
	if !ok {
		return nil, fmt.Errorf("toolchain %s not found", id)
	}
	return &domain.Toolchain{
		ID:          tc.ID,
		JavaHome:    tc.Home,
		Version:     tc.Version,
		Fingerprint: tc.Fingerprint,
	}, nil
}
