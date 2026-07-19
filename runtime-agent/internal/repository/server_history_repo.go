package repository

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"github.com/kairo-ide/runtime-agent/internal/domain"
	"github.com/kairo-ide/runtime-agent/internal/pathpolicy"
)

type FileServerHistoryRepo struct {
	mu      sync.Mutex
	dataDir string
}

func NewFileServerHistoryRepo(dataDir string) *FileServerHistoryRepo {
	return &FileServerHistoryRepo{dataDir: dataDir}
}

func (r *FileServerHistoryRepo) catalogDir() string {
	return filepath.Join(r.dataDir, "catalog", "runtime-servers")
}

func (r *FileServerHistoryRepo) workspaceDir(workspaceID domain.WorkspaceID) string {
	return filepath.Join(r.catalogDir(), string(workspaceID))
}

func (r *FileServerHistoryRepo) serverFilePath(workspaceID domain.WorkspaceID, serverID domain.ServerID) string {
	return filepath.Join(r.workspaceDir(workspaceID), string(serverID)+".json")
}

func (r *FileServerHistoryRepo) loadServer(path string) (*domain.ServerRecord, error) {
	doc, err := ReadVersionedJSON[domain.ServerRecord](path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, domain.ErrServerNotFound
		}
		return nil, fmt.Errorf("read server record from %s: %w", path, err)
	}
	return &doc.Data, nil
}

func (r *FileServerHistoryRepo) writeServer(workspaceID domain.WorkspaceID, serverID domain.ServerID, record domain.ServerRecord) error {
	dir := r.workspaceDir(workspaceID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create server history dir %s: %w", dir, err)
	}
	path := r.serverFilePath(workspaceID, serverID)
	doc := NewVersioned(record)
	return AtomicWriteJSON(path, doc, 0644)
}

func (r *FileServerHistoryRepo) scanWorkspace(ctx context.Context, workspaceID domain.WorkspaceID) ([]*domain.ServerRecord, []error, error) {
	wsDir := r.workspaceDir(workspaceID)
	entries, err := os.ReadDir(wsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, nil
		}
		return nil, nil, fmt.Errorf("read workspace server dir %s: %w", wsDir, err)
	}

	var records []*domain.ServerRecord
	var errs []error

	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		if entry.IsDir() {
			continue
		}
		ext := filepath.Ext(entry.Name())
		if ext != ".json" {
			continue
		}
		sidStr := entry.Name()[:len(entry.Name())-len(ext)]
		sid := domain.ServerID(sidStr)
		if err := pathpolicy.ValidateServerID(string(sid)); err != nil {
			errs = append(errs, fmt.Errorf("invalid server id in filename %q: %w", entry.Name(), err))
			continue
		}
		path := filepath.Join(wsDir, entry.Name())
		rec, err := r.loadServer(path)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		cp := rec.DeepCopy()
		records = append(records, &cp)
	}

	return records, errs, nil
}

func sortByUpdatedAtDesc(records []*domain.ServerRecord) {
	sort.Slice(records, func(i, j int) bool {
		return records[i].UpdatedAt.After(records[j].UpdatedAt)
	})
}

func applyLimit(records []*domain.ServerRecord, limit int) []*domain.ServerRecord {
	if limit > 0 && len(records) > limit {
		return records[:limit]
	}
	return records
}

func cloneRecordPtr(rec *domain.ServerRecord) *domain.ServerRecord {
	if rec == nil {
		return nil
	}
	cp := rec.DeepCopy()
	return &cp
}

func cloneRecordPtrs(records []*domain.ServerRecord) []*domain.ServerRecord {
	if records == nil {
		return nil
	}
	out := make([]*domain.ServerRecord, len(records))
	for i := range records {
		cp := records[i].DeepCopy()
		out[i] = &cp
	}
	return out
}

func toValueSlice(records []*domain.ServerRecord) []domain.ServerRecord {
	if records == nil {
		return []domain.ServerRecord{}
	}
	out := make([]domain.ServerRecord, len(records))
	for i := range records {
		out[i] = records[i].DeepCopy()
	}
	return out
}

func (r *FileServerHistoryRepo) Save(ctx context.Context, record domain.ServerRecord) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(record.WorkspaceID)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(record.ProjectID)); err != nil {
		return fmt.Errorf("invalid project id: %w", err)
	}
	if err := pathpolicy.ValidateServerID(string(record.ID)); err != nil {
		return fmt.Errorf("invalid server id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	saved := record.DeepCopy()
	return r.writeServer(record.WorkspaceID, record.ID, saved)
}

func (r *FileServerHistoryRepo) Get(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) (*domain.ServerRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateServerID(string(serverID)); err != nil {
		return nil, fmt.Errorf("invalid server id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	path := r.serverFilePath(workspaceID, serverID)
	rec, err := r.loadServer(path)
	if err != nil {
		return nil, err
	}
	cp := rec.DeepCopy()
	return &cp, nil
}

func (r *FileServerHistoryRepo) List(ctx context.Context, workspaceID domain.WorkspaceID) ([]domain.ServerRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	records, errs, err := r.scanWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	sortByUpdatedAtDesc(records)

	result := toValueSlice(records)
	if len(errs) > 0 {
		return result, domain.NewAggregateError(errs)
	}
	return result, nil
}

func (r *FileServerHistoryRepo) ListWithLimit(ctx context.Context, workspaceID domain.WorkspaceID, limit int) ([]*domain.ServerRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	records, errs, err := r.scanWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	sortByUpdatedAtDesc(records)
	records = applyLimit(records, limit)

	result := cloneRecordPtrs(records)
	if len(errs) > 0 {
		return result, domain.NewAggregateError(errs)
	}
	return result, nil
}

func (r *FileServerHistoryRepo) ListByProject(ctx context.Context, workspaceID domain.WorkspaceID, projectID domain.ProjectID, limit int) ([]*domain.ServerRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return nil, fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateProjectID(string(projectID)); err != nil {
		return nil, fmt.Errorf("invalid project id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	records, errs, err := r.scanWorkspace(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	var filtered []*domain.ServerRecord
	for _, rec := range records {
		if rec.ProjectID == projectID {
			filtered = append(filtered, rec)
		}
	}

	sortByUpdatedAtDesc(filtered)
	filtered = applyLimit(filtered, limit)

	result := cloneRecordPtrs(filtered)
	if len(errs) > 0 {
		return result, domain.NewAggregateError(errs)
	}
	return result, nil
}

func (r *FileServerHistoryRepo) Delete(ctx context.Context, workspaceID domain.WorkspaceID, serverID domain.ServerID) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := pathpolicy.ValidateWorkspaceID(string(workspaceID)); err != nil {
		return fmt.Errorf("invalid workspace id: %w", err)
	}
	if err := pathpolicy.ValidateServerID(string(serverID)); err != nil {
		return fmt.Errorf("invalid server id: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	path := r.serverFilePath(workspaceID, serverID)
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return domain.ErrServerNotFound
		}
		return fmt.Errorf("stat server file %s: %w", path, err)
	}

	if err := os.Remove(path); err != nil {
		return fmt.Errorf("remove server file %s: %w", path, err)
	}
	return nil
}

func (r *FileServerHistoryRepo) ListNonTerminal(ctx context.Context) ([]*domain.ServerRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	catalogDir := r.catalogDir()
	wsEntries, err := os.ReadDir(catalogDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []*domain.ServerRecord{}, nil
		}
		return nil, fmt.Errorf("read catalog dir %s: %w", catalogDir, err)
	}

	var result []*domain.ServerRecord
	var errs []error

	for _, wsEntry := range wsEntries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if !wsEntry.IsDir() {
			continue
		}
		wsID := domain.WorkspaceID(wsEntry.Name())
		if err := pathpolicy.ValidateWorkspaceID(string(wsID)); err != nil {
			errs = append(errs, fmt.Errorf("invalid workspace id in dirname %q: %w", wsEntry.Name(), err))
			continue
		}

		records, recErrs, err := r.scanWorkspace(ctx, wsID)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		errs = append(errs, recErrs...)

		for _, rec := range records {
			if !rec.ObservedState.IsTerminal() {
				result = append(result, rec)
			}
		}
	}

	sortByUpdatedAtDesc(result)

	copied := cloneRecordPtrs(result)
	if len(errs) > 0 {
		return copied, domain.NewAggregateError(errs)
	}
	return copied, nil
}
