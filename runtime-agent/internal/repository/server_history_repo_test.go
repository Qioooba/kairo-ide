package repository

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

const (
	testSRV2 = domain.ServerID("srv_amcakbqhbaequcymbuha6earci")
	testSRV3 = domain.ServerID("srv_aqcqmbyibefawdanbyhraeiscm")
)

func newTestRecord(ws domain.WorkspaceID, prj domain.ProjectID, srv domain.ServerID, state domain.ServerState, desired domain.DesiredServerState) domain.ServerRecord {
	now := domain.UTCNow()
	return domain.ServerRecord{
		ID:            srv,
		WorkspaceID:   ws,
		ProjectID:     prj,
		DesiredState:  desired,
		ObservedState: state,
		Generation:    1,
		PID:           0,
		RuntimePlan: domain.RuntimePlan{
			WorkspaceID:  ws,
			ProjectID:    prj,
			ServerID:     srv,
			RuntimeID:    "tomcat6",
			CatalinaBase: filepath.Join(os.TempDir(), "kairo-test", string(srv)),
			HTTPPort:     8080,
			ShutdownPort: 8005,
			JVMOptions:   []string{"-Xmx512m"},
			Env:          []string{"CATALINA_OPTS=-Dtest=true"},
			Generation:   1,
		},
		UpdatedAt: now,
	}
}

func runningRecord(ws domain.WorkspaceID, prj domain.ProjectID, srv domain.ServerID, pid int) domain.ServerRecord {
	now := domain.UTCNow()
	startTime := now.Add(-1 * time.Second)
	pi := &domain.ProcessIdentity{
		PID:          pid,
		Executable:   "/usr/bin/java",
		StartTime:    startTime,
		CatalinaBase: filepath.Join(os.TempDir(), "kairo-test", string(srv)),
		MarkerToken:  "test-marker",
	}
	rec := newTestRecord(ws, prj, srv, domain.ServerStateRunning, domain.DesiredServerStateRunning)
	rec.PID = pid
	rec.ProcessIdentity = pi
	rec.StartedAt = &startTime
	rec.Generation = 1
	rec.UpdatedAt = now
	return rec
}

func TestFileServerHistoryRepo_SaveAndGet(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	rec := runningRecord(testWS1, testPRJ1, testSRV1, 12345)

	if err := repo.Save(ctx, rec); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := repo.Get(ctx, testWS1, testSRV1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	if got.ID != testSRV1 {
		t.Errorf("expected server ID %s, got %s", testSRV1, got.ID)
	}
	if got.ObservedState != domain.ServerStateRunning {
		t.Errorf("expected state running, got %s", got.ObservedState)
	}
	if got.DesiredState != domain.DesiredServerStateRunning {
		t.Errorf("expected desired state running, got %s", got.DesiredState)
	}
	if got.PID != 12345 {
		t.Errorf("expected PID 12345, got %d", got.PID)
	}
	if got.ProcessIdentity == nil {
		t.Fatal("expected ProcessIdentity to be set")
	}
	if got.ProcessIdentity.PID != 12345 {
		t.Errorf("expected ProcessIdentity.PID 12345, got %d", got.ProcessIdentity.PID)
	}
	if got.RuntimePlan.JVMOptions == nil || len(got.RuntimePlan.JVMOptions) == 0 {
		t.Error("expected RuntimePlan.JVMOptions to be set")
	}
}

func TestFileServerHistoryRepo_GetNotFound(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	_, err := repo.Get(ctx, testWS1, testSRV1)
	if !errors.Is(err, domain.ErrServerNotFound) {
		t.Errorf("expected ErrServerNotFound, got %v", err)
	}
}

func TestFileServerHistoryRepo_List(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	now := domain.UTCNow()
	rec1 := newTestRecord(testWS1, testPRJ1, testSRV1, domain.ServerStateStopped, domain.DesiredServerStateStopped)
	rec1.UpdatedAt = now.Add(-2 * time.Minute)
	rec2 := runningRecord(testWS1, testPRJ1, testSRV2, 12346)
	rec2.UpdatedAt = now.Add(-1 * time.Minute)

	repo.Save(ctx, rec1)
	repo.Save(ctx, rec2)

	list, err := repo.List(ctx, testWS1)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 records, got %d", len(list))
	}
	if list[0].ID != testSRV2 {
		t.Errorf("expected first record to be %s (newest), got %s", testSRV2, list[0].ID)
	}
	if list[1].ID != testSRV1 {
		t.Errorf("expected second record to be %s (oldest), got %s", testSRV1, list[1].ID)
	}
}

func TestFileServerHistoryRepo_ListEmpty(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	list, err := repo.List(ctx, testWS1)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list) != 0 {
		t.Errorf("expected 0 records, got %d", len(list))
	}
}

func TestFileServerHistoryRepo_ListWithLimit(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	baseTime := domain.UTCNow()
	for i, srv := range []domain.ServerID{testSRV1, testSRV2, testSRV3} {
		rec := newTestRecord(testWS1, testPRJ1, srv, domain.ServerStateStopped, domain.DesiredServerStateStopped)
		rec.UpdatedAt = baseTime.Add(time.Duration(i) * time.Minute)
		repo.Save(ctx, rec)
	}

	list, err := repo.ListWithLimit(ctx, testWS1, 2)
	if err != nil {
		t.Fatalf("ListWithLimit failed: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 records, got %d", len(list))
	}
	if list[0].ID != testSRV3 {
		t.Errorf("expected first record to be %s (newest), got %s", testSRV3, list[0].ID)
	}
}

func TestFileServerHistoryRepo_ListByProject(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	baseTime := domain.UTCNow()

	rec1 := runningRecord(testWS1, testPRJ1, testSRV1, 1001)
	rec1.UpdatedAt = baseTime.Add(-1 * time.Minute)
	rec2 := runningRecord(testWS1, testPRJ2, testSRV2, 1002)
	rec2.UpdatedAt = baseTime
	rec3 := runningRecord(testWS1, testPRJ1, testSRV3, 1003)
	rec3.UpdatedAt = baseTime.Add(-30 * time.Second)

	repo.Save(ctx, rec1)
	repo.Save(ctx, rec2)
	repo.Save(ctx, rec3)

	prj1List, err := repo.ListByProject(ctx, testWS1, testPRJ1, 10)
	if err != nil {
		t.Fatalf("ListByProject failed: %v", err)
	}
	if len(prj1List) != 2 {
		t.Fatalf("expected 2 records for project %s, got %d", testPRJ1, len(prj1List))
	}
	for _, r := range prj1List {
		if r.ProjectID != testPRJ1 {
			t.Errorf("expected project %s, got %s", testPRJ1, r.ProjectID)
		}
	}
	if prj1List[0].ID != testSRV3 {
		t.Errorf("expected first record %s (newest), got %s", testSRV3, prj1List[0].ID)
	}

	prj2List, err := repo.ListByProject(ctx, testWS1, testPRJ2, 10)
	if err != nil {
		t.Fatalf("ListByProject for PRJ2 failed: %v", err)
	}
	if len(prj2List) != 1 {
		t.Fatalf("expected 1 record for project %s, got %d", testPRJ2, len(prj2List))
	}
	if prj2List[0].ID != testSRV2 {
		t.Errorf("expected record %s, got %s", testSRV2, prj2List[0].ID)
	}
}

func TestFileServerHistoryRepo_Delete(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	rec := runningRecord(testWS1, testPRJ1, testSRV1, 12345)
	repo.Save(ctx, rec)

	if err := repo.Delete(ctx, testWS1, testSRV1); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	_, err := repo.Get(ctx, testWS1, testSRV1)
	if !errors.Is(err, domain.ErrServerNotFound) {
		t.Errorf("expected ErrServerNotFound after delete, got %v", err)
	}
}

func TestFileServerHistoryRepo_DeleteNotFound(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	err := repo.Delete(ctx, testWS1, testSRV1)
	if !errors.Is(err, domain.ErrServerNotFound) {
		t.Errorf("expected ErrServerNotFound, got %v", err)
	}
}

func TestFileServerHistoryRepo_Update(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	rec := newTestRecord(testWS1, testPRJ1, testSRV1, domain.ServerStatePreparing, domain.DesiredServerStateRunning)
	if err := repo.Save(ctx, rec); err != nil {
		t.Fatalf("Save preparing failed: %v", err)
	}

	running := runningRecord(testWS1, testPRJ1, testSRV1, 12345)
	if err := repo.Save(ctx, running); err != nil {
		t.Fatalf("Save running failed: %v", err)
	}

	got, err := repo.Get(ctx, testWS1, testSRV1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.ObservedState != domain.ServerStateRunning {
		t.Errorf("expected state running after update, got %s", got.ObservedState)
	}
	if got.PID != 12345 {
		t.Errorf("expected PID 12345 after update, got %d", got.PID)
	}
	if got.Generation != 1 {
		t.Errorf("expected generation 1, got %d", got.Generation)
	}
}

func TestFileServerHistoryRepo_DeepCopy(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	rec := runningRecord(testWS1, testPRJ1, testSRV1, 12345)
	repo.Save(ctx, rec)

	got1, err := repo.Get(ctx, testWS1, testSRV1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}

	got1.ObservedState = domain.ServerStateStopped
	got1.RuntimePlan.JVMOptions[0] = "-Xmx1g"
	got1.LastError = "modified error"
	if got1.ProcessIdentity != nil {
		got1.ProcessIdentity.PID = 99999
	}
	if got1.StartedAt != nil {
		newTime := time.Now().Add(1 * time.Hour)
		got1.StartedAt = &newTime
	}

	got2, err := repo.Get(ctx, testWS1, testSRV1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got2.ObservedState == domain.ServerStateStopped {
		t.Error("mutation of returned record affected stored record (ObservedState)")
	}
	if got2.RuntimePlan.JVMOptions[0] == "-Xmx1g" {
		t.Error("mutation of returned record affected stored record (RuntimePlan.JVMOptions)")
	}
	if got2.ProcessIdentity != nil && got2.ProcessIdentity.PID == 99999 {
		t.Error("mutation of returned record affected stored record (ProcessIdentity)")
	}
}

func TestFileServerHistoryRepo_ListReturnsDeepCopy(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	rec := runningRecord(testWS1, testPRJ1, testSRV1, 12345)
	repo.Save(ctx, rec)

	list1, err := repo.List(ctx, testWS1)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list1) != 1 {
		t.Fatalf("expected 1 record, got %d", len(list1))
	}
	list1[0].ObservedState = domain.ServerStateStopped
	list1[0].RuntimePlan.JVMOptions[0] = "-Xmx999m"

	list2, err := repo.List(ctx, testWS1)
	if err != nil {
		t.Fatalf("List second call failed: %v", err)
	}
	if list2[0].ObservedState == domain.ServerStateStopped {
		t.Error("List returned shared reference (ObservedState mutation propagated)")
	}
	if list2[0].RuntimePlan.JVMOptions[0] == "-Xmx999m" {
		t.Error("List returned shared reference (JVMOptions mutation propagated)")
	}
}

func TestFileServerHistoryRepo_InvalidID(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	tests := []struct {
		name string
		ws   domain.WorkspaceID
		prj  domain.ProjectID
		srv  domain.ServerID
	}{
		{"bad server prefix", testWS1, testPRJ1, "srv_bad"},
		{"short server", testWS1, testPRJ1, "srv_aaaaaaaaaaaaaaaaaaaaaaaaa"},
		{"path traversal in ws", "ws_aaaaaaaaaaaaaaaaaaaaaaaa..", testPRJ1, testSRV1},
		{"absolute path ws", "/etc/passwd", testPRJ1, testSRV1},
		{"backslash", "ws_\\windows", testPRJ1, testSRV1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := newTestRecord(tt.ws, tt.prj, tt.srv, domain.ServerStateStopped, domain.DesiredServerStateStopped)
			err := repo.Save(ctx, rec)
			if err == nil {
				t.Errorf("expected error for invalid ID, got nil")
			}
		})
	}

	t.Run("Get invalid workspace", func(t *testing.T) {
		_, err := repo.Get(ctx, "bad_ws", testSRV1)
		if err == nil {
			t.Error("expected error for invalid workspace ID in Get")
		}
	})

	t.Run("Get invalid server", func(t *testing.T) {
		_, err := repo.Get(ctx, testWS1, "bad_srv")
		if err == nil {
			t.Error("expected error for invalid server ID in Get")
		}
	})

	t.Run("Delete invalid server", func(t *testing.T) {
		err := repo.Delete(ctx, testWS1, "../escape")
		if err == nil {
			t.Error("expected error for invalid server ID in Delete")
		}
	})

	t.Run("List invalid workspace", func(t *testing.T) {
		_, err := repo.List(ctx, "../escape")
		if err == nil {
			t.Error("expected error for invalid workspace ID in List")
		}
	})
}

func TestFileServerHistoryRepo_CorruptionNotSwallowed(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	rec1 := runningRecord(testWS1, testPRJ1, testSRV1, 1001)
	rec2 := runningRecord(testWS1, testPRJ1, testSRV2, 1002)
	repo.Save(ctx, rec1)
	repo.Save(ctx, rec2)

	wsDir := filepath.Join(dir, "catalog", "runtime-servers", string(testWS1))
	corruptFile := filepath.Join(wsDir, string(testSRV2)+".json")
	if err := os.WriteFile(corruptFile, []byte("{not valid json!!!"), 0644); err != nil {
		t.Fatalf("failed to corrupt file: %v", err)
	}

	_, err := repo.List(ctx, testWS1)
	if err == nil {
		t.Fatal("expected error due to corruption, got nil")
	}

	t.Logf("corruption error: %v", err)
}

func TestFileServerHistoryRepo_SchemaMismatch(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	rec := runningRecord(testWS1, testPRJ1, testSRV1, 1001)
	repo.Save(ctx, rec)

	srvFile := filepath.Join(dir, "catalog", "runtime-servers", string(testWS1), string(testSRV1)+".json")

	data, err := os.ReadFile(srvFile)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}

	var doc map[string]interface{}
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	doc["schemaVersion"] = 99
	modified, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		t.Fatalf("failed to marshal modified: %v", err)
	}
	if err := os.WriteFile(srvFile, modified, 0644); err != nil {
		t.Fatalf("failed to write modified schema: %v", err)
	}

	_, err = repo.Get(ctx, testWS1, testSRV1)
	if err == nil {
		t.Fatal("expected error due to schema mismatch, got nil")
	}
	t.Logf("schema mismatch error: %v", err)
}

func TestFileServerHistoryRepo_ListNonTerminal(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	running := runningRecord(testWS1, testPRJ1, testSRV1, 1001)
	stopped := newTestRecord(testWS1, testPRJ1, testSRV2, domain.ServerStateStopped, domain.DesiredServerStateStopped)
	failed := newTestRecord(testWS1, testPRJ2, testSRV3, domain.ServerStateFailed, domain.DesiredServerStateStopped)
	starting := newTestRecord(testWS1, testPRJ2, testSRV2, domain.ServerStateStarting, domain.DesiredServerStateRunning)

	repo.Save(ctx, running)
	repo.Save(ctx, stopped)
	repo.Save(ctx, failed)
	repo.Save(ctx, starting)

	nonTerm, err := repo.ListNonTerminal(ctx)
	if err != nil {
		t.Fatalf("ListNonTerminal failed: %v", err)
	}

	if len(nonTerm) != 2 {
		t.Fatalf("expected 2 non-terminal records (running, starting), got %d", len(nonTerm))
	}

	foundRunning := false
	foundStarting := false
	for _, r := range nonTerm {
		if r.ID == testSRV1 && r.ObservedState == domain.ServerStateRunning {
			foundRunning = true
		}
		if r.ID == testSRV2 && r.ObservedState == domain.ServerStateStarting {
			foundStarting = true
		}
		if r.ObservedState == domain.ServerStateStopped || r.ObservedState == domain.ServerStateFailed {
			t.Errorf("unexpected terminal state %s in non-terminal list", r.ObservedState)
		}
	}
	if !foundRunning {
		t.Error("expected running server SRV1 in non-terminal list")
	}
	if !foundStarting {
		t.Error("expected starting server SRV2 in non-terminal list")
	}
}

func TestFileServerHistoryRepo_ListNonTerminalAcrossWorkspaces(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	r1 := runningRecord(testWS1, testPRJ1, testSRV1, 1001)
	r2 := runningRecord(testWS2, testPRJ2, testSRV2, 2002)
	stopped := newTestRecord(testWS1, testPRJ1, testSRV3, domain.ServerStateStopped, domain.DesiredServerStateStopped)

	repo.Save(ctx, r1)
	repo.Save(ctx, r2)
	repo.Save(ctx, stopped)

	nonTerm, err := repo.ListNonTerminal(ctx)
	if err != nil {
		t.Fatalf("ListNonTerminal failed: %v", err)
	}
	if len(nonTerm) != 2 {
		t.Fatalf("expected 2 non-terminal records across workspaces, got %d", len(nonTerm))
	}
}

func TestFileServerHistoryRepo_AgentCrashLeavesRunningRecord(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	running := runningRecord(testWS1, testPRJ1, testSRV1, 99999)
	startTime := domain.UTCNow().Add(-30 * time.Second)
	running.StartedAt = &startTime
	if err := repo.Save(ctx, running); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	repo2 := NewFileServerHistoryRepo(dir)
	nonTerm, err := repo2.ListNonTerminal(ctx)
	if err != nil {
		t.Fatalf("ListNonTerminal after simulated crash failed: %v", err)
	}
	if len(nonTerm) != 1 {
		t.Fatalf("expected 1 non-terminal record after crash, got %d", len(nonTerm))
	}
	if nonTerm[0].PID != 99999 {
		t.Errorf("expected PID 99999 in recovered record, got %d", nonTerm[0].PID)
	}
	if nonTerm[0].ObservedState != domain.ServerStateRunning {
		t.Errorf("expected running state, got %s", nonTerm[0].ObservedState)
	}
}

func TestFileServerHistoryRepo_ContextCancellation(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	rec := newTestRecord(testWS1, testPRJ1, testSRV1, domain.ServerStateStopped, domain.DesiredServerStateStopped)
	if err := repo.Save(ctx, rec); err == nil {
		t.Error("Save should fail with cancelled context")
	}

	if _, err := repo.Get(ctx, testWS1, testSRV1); err == nil {
		t.Error("Get should fail with cancelled context")
	}

	if _, err := repo.List(ctx, testWS1); err == nil {
		t.Error("List should fail with cancelled context")
	}

	if err := repo.Delete(ctx, testWS1, testSRV1); err == nil {
		t.Error("Delete should fail with cancelled context")
	}

	if _, err := repo.ListNonTerminal(ctx); err == nil {
		t.Error("ListNonTerminal should fail with cancelled context")
	}
}

func TestFileServerHistoryRepo_ConcurrentSaveGetList(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	const goroutines = 100
	var wg sync.WaitGroup
	wg.Add(goroutines * 3)

	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			srv := domain.ServerID("srv_aaaaaaaaaaaaaaaaaaaaaaaaaa")
			rec := newTestRecord(testWS1, testPRJ1, srv, domain.ServerStateRunning, domain.DesiredServerStateRunning)
			rec.Generation = uint64(idx)
			rec.UpdatedAt = domain.UTCNow()
			if err := repo.Save(ctx, rec); err != nil {
				t.Errorf("concurrent Save failed: %v", err)
			}
		}(i)
	}

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			_, _ = repo.Get(ctx, testWS1, testSRV1)
		}()
	}

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			_, _ = repo.List(ctx, testWS1)
		}()
	}

	wg.Wait()
}

func TestFileServerHistoryRepo_VersionedJSONFormat(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	rec := runningRecord(testWS1, testPRJ1, testSRV1, 12345)
	if err := repo.Save(ctx, rec); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	srvFile := filepath.Join(dir, "catalog", "runtime-servers", string(testWS1), string(testSRV1)+".json")
	data, err := os.ReadFile(srvFile)
	if err != nil {
		t.Fatalf("failed to read file: %v", err)
	}

	var doc map[string]interface{}
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatalf("failed to parse JSON: %v", err)
	}

	if sv, ok := doc["schemaVersion"].(float64); !ok || sv != 1 {
		t.Errorf("expected schemaVersion=1, got %v", doc["schemaVersion"])
	}
	if _, ok := doc["updatedAt"]; !ok {
		t.Error("expected updatedAt field")
	}
	dataField, ok := doc["data"].(map[string]interface{})
	if !ok {
		t.Fatal("expected data field to be an object")
	}
	if dataField["id"] != string(testSRV1) {
		t.Errorf("expected data.id=%s, got %v", testSRV1, dataField["id"])
	}
	if dataField["observedState"] != string(domain.ServerStateRunning) {
		t.Errorf("expected data.observedState=running, got %v", dataField["observedState"])
	}
	if dataField["desiredState"] != string(domain.DesiredServerStateRunning) {
		t.Errorf("expected data.desiredState=running, got %v", dataField["desiredState"])
	}
}

func TestFileServerHistoryRepo_DesiredVsObservedState(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	rec := newTestRecord(testWS1, testPRJ1, testSRV1, domain.ServerStateStopping, domain.DesiredServerStateStopped)
	rec.PID = 12345
	if err := repo.Save(ctx, rec); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := repo.Get(ctx, testWS1, testSRV1)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.ObservedState != domain.ServerStateStopping {
		t.Errorf("expected observed state stopping, got %s", got.ObservedState)
	}
	if got.DesiredState != domain.DesiredServerStateStopped {
		t.Errorf("expected desired state stopped, got %s", got.DesiredState)
	}
}

func TestFileServerHistoryRepo_StableSortOrder(t *testing.T) {
	dir := t.TempDir()
	repo := NewFileServerHistoryRepo(dir)
	ctx := context.Background()

	baseTime := domain.UTCNow()
	for i := 0; i < 5; i++ {
		var srv domain.ServerID
		switch i {
		case 0:
			srv = testSRV1
		case 1:
			srv = testSRV2
		case 2:
			srv = testSRV3
		default:
			gen := domain.ServerID("srv_")
			_ = gen
			continue
		}
		rec := newTestRecord(testWS1, testPRJ1, srv, domain.ServerStateStopped, domain.DesiredServerStateStopped)
		rec.UpdatedAt = baseTime.Add(time.Duration(i) * time.Second)
		repo.Save(ctx, rec)
	}

	list, err := repo.List(ctx, testWS1)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}

	for i := 1; i < len(list); i++ {
		if list[i].UpdatedAt.After(list[i-1].UpdatedAt) {
			t.Errorf("sort order violated at index %d: %v after %v", i, list[i].UpdatedAt, list[i-1].UpdatedAt)
		}
	}
}
