//go:build remote

package remote

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestNewFileSyncService tests basic creation of the file sync service.
func TestNewFileSyncService(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)
	if svc == nil {
		t.Fatal("NewFileSyncService returned nil")
	}
	if svc.basePath != dir {
		t.Errorf("basePath = %q, want %q", svc.basePath, dir)
	}
	if svc.fileHashes == nil {
		t.Error("fileHashes map is nil")
	}
	if svc.maxHistory != 1000 {
		t.Errorf("maxHistory = %d, want 1000", svc.maxHistory)
	}
}

// TestComputeFileHash tests SHA-256 hash computation of a file.
func TestComputeFileHash(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	filename := filepath.Join(dir, "test.txt")
	content := []byte("hello world")
	if err := os.WriteFile(filename, content, 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	hash, err := svc.ComputeFileHash("test.txt")
	if err != nil {
		t.Fatalf("ComputeFileHash: %v", err)
	}
	if hash == "" {
		t.Error("hash is empty")
	}
	if len(hash) != 64 {
		t.Errorf("hash length = %d, want 64", len(hash))
	}
}

// TestComputeFileHash_NotFound tests hash computation on a missing file.
func TestComputeFileHash_NotFound(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	_, err := svc.ComputeFileHash("nonexistent.txt")
	if err == nil {
		t.Fatal("expected error for nonexistent file, got nil")
	}
}

// TestComputeFileHash_DifferentContent tests that different content produces different hashes.
func TestComputeFileHash_DifferentContent(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello"), 0644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("world"), 0644)

	hashA, _ := svc.ComputeFileHash("a.txt")
	hashB, _ := svc.ComputeFileHash("b.txt")

	if hashA == hashB {
		t.Error("hashes of different content should differ")
	}
}

// TestComputeFileHash_SameContent tests that same content produces same hash.
func TestComputeFileHash_SameContent(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("same"), 0644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("same"), 0644)

	hashA, _ := svc.ComputeFileHash("a.txt")
	hashB, _ := svc.ComputeFileHash("b.txt")

	if hashA != hashB {
		t.Error("hashes of same content should be equal")
	}
}

// TestScanDirectory tests scanning a directory and computing all file hashes.
func TestScanDirectory(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	os.WriteFile(filepath.Join(dir, "file1.txt"), []byte("content1"), 0644)
	os.WriteFile(filepath.Join(dir, "file2.txt"), []byte("content2"), 0644)
	os.MkdirAll(filepath.Join(dir, "sub"), 0755)
	os.WriteFile(filepath.Join(dir, "sub", "file3.txt"), []byte("content3"), 0644)

	hashes, err := svc.ScanDirectory()
	if err != nil {
		t.Fatalf("ScanDirectory: %v", err)
	}

	if len(hashes) != 3 {
		t.Errorf("expected 3 files, got %d", len(hashes))
	}

	for _, p := range []string{"file1.txt", "file2.txt", filepath.FromSlash("sub/file3.txt")} {
		if _, ok := hashes[p]; !ok {
			t.Errorf("missing path %q in hashes", p)
		}
	}
}

// TestScanDirectory_Empty tests scanning an empty directory.
func TestScanDirectory_Empty(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	hashes, err := svc.ScanDirectory()
	if err != nil {
		t.Fatalf("ScanDirectory: %v", err)
	}

	if len(hashes) != 0 {
		t.Errorf("expected 0 files, got %d", len(hashes))
	}
}

// TestScanDirectory_Nonexistent tests scanning a nonexistent directory.
func TestScanDirectory_Nonexistent(t *testing.T) {
	svc := NewFileSyncService("/nonexistent/path/12345")

	_, err := svc.ScanDirectory()
	if err == nil {
		t.Fatal("expected error for nonexistent directory, got nil")
	}
}

// TestCompareWithRemote_NewLocalFiles tests comparison when local has new files.
func TestCompareWithRemote_NewLocalFiles(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	os.WriteFile(filepath.Join(dir, "local.txt"), []byte("local content"), 0644)
	svc.ScanDirectory()

	remoteHashes := map[string]string{}
	plan := svc.CompareWithRemote(remoteHashes)

	if len(plan.ToUpload) != 1 {
		t.Errorf("expected 1 upload, got %d", len(plan.ToUpload))
	}
	if plan.ToUpload[0].Path != "local.txt" {
		t.Errorf("upload path = %q, want %q", plan.ToUpload[0].Path, "local.txt")
	}
	if len(plan.ToDownload) != 0 {
		t.Errorf("expected 0 downloads, got %d", len(plan.ToDownload))
	}
	if len(plan.Conflicts) != 0 {
		t.Errorf("expected 0 conflicts, got %d", len(plan.Conflicts))
	}
	if plan.TotalSize <= 0 {
		t.Error("TotalSize should be > 0")
	}
}

// TestCompareWithRemote_NewRemoteFiles tests comparison when remote has new files.
func TestCompareWithRemote_NewRemoteFiles(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	svc.ScanDirectory()

	remoteHashes := map[string]string{
		"remote.txt": "abc123",
	}
	plan := svc.CompareWithRemote(remoteHashes)

	if len(plan.ToDownload) != 1 {
		t.Errorf("expected 1 download, got %d", len(plan.ToDownload))
	}
	if plan.ToDownload[0].Path != "remote.txt" {
		t.Errorf("download path = %q, want %q", plan.ToDownload[0].Path, "remote.txt")
	}
	if plan.ToDownload[0].Hash != "abc123" {
		t.Errorf("download hash = %q, want %q", plan.ToDownload[0].Hash, "abc123")
	}
	if len(plan.ToUpload) != 0 {
		t.Errorf("expected 0 uploads, got %d", len(plan.ToUpload))
	}
}

// TestCompareWithRemote_Conflicts tests comparison when files differ.
func TestCompareWithRemote_Conflicts(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	os.WriteFile(filepath.Join(dir, "shared.txt"), []byte("local version"), 0644)
	svc.ScanDirectory()

	remoteHashes := map[string]string{
		"shared.txt": "different-hash",
	}
	plan := svc.CompareWithRemote(remoteHashes)

	if len(plan.Conflicts) != 1 {
		t.Errorf("expected 1 conflict, got %d", len(plan.Conflicts))
	}
	if plan.Conflicts[0].Path != "shared.txt" {
		t.Errorf("conflict path = %q, want %q", plan.Conflicts[0].Path, "shared.txt")
	}
	if plan.Conflicts[0].RemoteHash != "different-hash" {
		t.Errorf("remote hash = %q, want %q", plan.Conflicts[0].RemoteHash, "different-hash")
	}
}

// TestCompareWithRemote_NoChanges tests comparison when files are identical.
func TestCompareWithRemote_NoChanges(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	content := []byte("same content")
	os.WriteFile(filepath.Join(dir, "same.txt"), content, 0644)
	svc.ScanDirectory()

	hash, _ := svc.ComputeFileHash("same.txt")
	remoteHashes := map[string]string{
		"same.txt": hash,
	}
	plan := svc.CompareWithRemote(remoteHashes)

	if len(plan.ToUpload) != 0 || len(plan.ToDownload) != 0 || len(plan.Conflicts) != 0 {
		t.Error("expected empty plan for identical files")
	}
}

// TestSyncFile_Upload tests uploading a file via SyncFile.
func TestSyncFile_Upload(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	content := []byte("uploaded content")
	err := svc.SyncFile("newfile.txt", SyncUpload, content)
	if err != nil {
		t.Fatalf("SyncFile: %v", err)
	}

	// Verify file was written
	written, err := os.ReadFile(filepath.Join(dir, "newfile.txt"))
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if string(written) != string(content) {
		t.Errorf("content = %q, want %q", string(written), string(content))
	}

	// Verify history
	history := svc.GetSyncHistory()
	if len(history) != 1 {
		t.Fatalf("expected 1 history record, got %d", len(history))
	}
	if !history[0].Success {
		t.Error("sync record should be successful")
	}
	if history[0].Path != "newfile.txt" {
		t.Errorf("history path = %q, want %q", history[0].Path, "newfile.txt")
	}
	if history[0].Direction != SyncUpload {
		t.Errorf("history direction = %q, want %q", history[0].Direction, SyncUpload)
	}
}

// TestSyncFile_Download tests downloading a file via SyncFile.
func TestSyncFile_Download(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	content := []byte("downloaded content")
	err := svc.SyncFile("dl.txt", SyncDownload, content)
	if err != nil {
		t.Fatalf("SyncFile: %v", err)
	}

	written, _ := os.ReadFile(filepath.Join(dir, "dl.txt"))
	if string(written) != string(content) {
		t.Errorf("content = %q, want %q", string(written), string(content))
	}

	history := svc.GetSyncHistory()
	if len(history) != 1 {
		t.Fatalf("expected 1 history record, got %d", len(history))
	}
	if history[0].Direction != SyncDownload {
		t.Errorf("history direction = %q, want %q", history[0].Direction, SyncDownload)
	}
}

// TestSyncFile_NestedPath tests syncing a file in a nested directory.
func TestSyncFile_NestedPath(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	err := svc.SyncFile("deep/nested/file.txt", SyncUpload, []byte("deep"))
	if err != nil {
		t.Fatalf("SyncFile: %v", err)
	}

	written, _ := os.ReadFile(filepath.Join(dir, "deep/nested/file.txt"))
	if string(written) != "deep" {
		t.Errorf("content = %q, want %q", string(written), "deep")
	}
}

// TestApplySyncPlan tests applying a sync plan end-to-end.
func TestApplySyncPlan(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	os.WriteFile(filepath.Join(dir, "f1.txt"), []byte("file1"), 0644)
	os.WriteFile(filepath.Join(dir, "f2.txt"), []byte("file2"), 0644)
	svc.ScanDirectory()

	remoteHashes := map[string]string{
		"remote1.txt": "abc",
		"remote2.txt": "def",
	}
	plan := svc.CompareWithRemote(remoteHashes)

	uploaded, downloaded, errors := svc.ApplySyncPlan(plan)
	if len(errors) != 0 {
		t.Errorf("unexpected errors: %v", errors)
	}
	if uploaded != 2 {
		t.Errorf("uploaded = %d, want 2", uploaded)
	}
	if downloaded != 2 {
		t.Errorf("downloaded = %d, want 2", downloaded)
	}
}

// TestApplySyncPlan_Nil tests applying a nil plan.
func TestApplySyncPlan_Nil(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	uploaded, downloaded, errors := svc.ApplySyncPlan(nil)
	if uploaded != 0 || downloaded != 0 || len(errors) != 0 {
		t.Error("nil plan should return zero values")
	}
}

// TestResolveConflict_Local tests resolving a conflict with "local" strategy.
func TestResolveConflict_Local(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	err := svc.ResolveConflict("file.txt", "local")
	if err != nil {
		t.Fatalf("ResolveConflict(local): %v", err)
	}
}

// TestResolveConflict_Remote tests resolving a conflict with "remote" strategy.
func TestResolveConflict_Remote(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	// First add file to hashes
	os.WriteFile(filepath.Join(dir, "file.txt"), []byte("local"), 0644)
	svc.ScanDirectory()

	err := svc.ResolveConflict("file.txt", "remote")
	if err != nil {
		t.Fatalf("ResolveConflict(remote): %v", err)
	}

	// Verify hash was removed
	svc.mu.RLock()
	_, exists := svc.fileHashes["file.txt"]
	svc.mu.RUnlock()
	if exists {
		t.Error("file hash should be removed after remote resolution")
	}
}

// TestResolveConflict_Merge tests resolving a conflict with "merge" strategy.
func TestResolveConflict_Merge(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	err := svc.ResolveConflict("file.txt", "merge")
	if err != nil {
		t.Fatalf("ResolveConflict(merge): %v", err)
	}
}

// TestResolveConflict_Invalid tests resolving a conflict with invalid strategy.
func TestResolveConflict_Invalid(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	err := svc.ResolveConflict("file.txt", "invalid")
	if err == nil {
		t.Fatal("expected error for invalid resolution, got nil")
	}
}

// TestResolveConflicts tests resolving multiple conflicts.
func TestResolveConflicts(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	conflicts := []FileConflict{
		{Path: "a.txt", LocalHash: "a1", RemoteHash: "a2"},
		{Path: "b.txt", LocalHash: "b1", RemoteHash: "b2"},
	}

	err := svc.ResolveConflicts(conflicts, "local")
	if err != nil {
		t.Fatalf("ResolveConflicts: %v", err)
	}
}

// TestGetSyncHistory_Empty tests getting history when no syncs have occurred.
func TestGetSyncHistory_Empty(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	history := svc.GetSyncHistory()
	if len(history) != 0 {
		t.Errorf("expected empty history, got %d records", len(history))
	}
}

// TestSyncRecord_Fields tests that sync records have all fields populated.
func TestSyncRecord_Fields(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	err := svc.SyncFile("record.txt", SyncUpload, []byte("test"))
	if err != nil {
		t.Fatalf("SyncFile: %v", err)
	}

	history := svc.GetSyncHistory()
	rec := history[0]

	if rec.Path != "record.txt" {
		t.Errorf("Path = %q, want record.txt", rec.Path)
	}
	if rec.Direction != SyncUpload {
		t.Errorf("Direction = %q, want upload", rec.Direction)
	}
	if !rec.Success {
		t.Error("Success should be true")
	}
	if rec.Size != 4 {
		t.Errorf("Size = %d, want 4", rec.Size)
	}
	if rec.Hash == "" {
		t.Error("Hash should not be empty")
	}
	if rec.Error != "" {
		t.Errorf("Error should be empty, got %q", rec.Error)
	}
	if rec.Timestamp.IsZero() {
		t.Error("Timestamp should not be zero")
	}
}

// TestSyncRecord_Failure tests that failed syncs are recorded with error info.
func TestSyncRecord_Failure(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	// Try to sync to a path that would fail (e.g., parent is a file)
	blockingFile := filepath.Join(dir, "blocker")
	os.WriteFile(blockingFile, []byte("block"), 0644)

	// Attempt to sync a file where a parent segment is a file
	err := svc.SyncFile("blocker/sub/file.txt", SyncUpload, []byte("data"))
	if err == nil {
		t.Fatal("expected error, got nil")
	}

	history := svc.GetSyncHistory()
	if len(history) != 1 {
		t.Fatalf("expected 1 history record, got %d", len(history))
	}
	if history[0].Success {
		t.Error("record should be marked as failure")
	}
	if history[0].Error == "" {
		t.Error("error field should not be empty on failure")
	}
}

// TestSyncHistory_MaxLimit tests that history is capped at maxHistory.
func TestSyncHistory_MaxLimit(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)
	svc.maxHistory = 5

	for i := 0; i < 10; i++ {
		content := []byte("data")
		h := svc.fileHashes // dummy read to avoid issues
		_ = h
		// Use SyncFile to record history
		os.WriteFile(filepath.Join(dir, "temp.txt"), content, 0644)
		svc.SyncFile("temp.txt", SyncUpload, content)
	}

	history := svc.GetSyncHistory()
	if len(history) > 5 {
		t.Errorf("history should be capped at 5, got %d", len(history))
	}
}

// TestCompareWithRemote_MixedScenario tests complex mixed scenario.
func TestCompareWithRemote_MixedScenario(t *testing.T) {
	dir := t.TempDir()
	svc := NewFileSyncService(dir)

	os.WriteFile(filepath.Join(dir, "local_only.txt"), []byte("local"), 0644)
	os.WriteFile(filepath.Join(dir, "shared.txt"), []byte("shared-local"), 0644)
	os.WriteFile(filepath.Join(dir, "identical.txt"), []byte("same"), 0644)
	svc.ScanDirectory()

	hash, _ := svc.ComputeFileHash("identical.txt")
	remoteHashes := map[string]string{
		"remote_only.txt": "remote-hash",
		"shared.txt":      "different-hash",
		"identical.txt":   hash,
	}

	plan := svc.CompareWithRemote(remoteHashes)

	if len(plan.ToUpload) != 1 || plan.ToUpload[0].Path != "local_only.txt" {
		t.Errorf("upload: expected [local_only.txt], got %d files", len(plan.ToUpload))
	}
	if len(plan.ToDownload) != 1 || plan.ToDownload[0].Path != "remote_only.txt" {
		t.Errorf("download: expected [remote_only.txt], got %d files", len(plan.ToDownload))
	}
	if len(plan.Conflicts) != 1 || plan.Conflicts[0].Path != "shared.txt" {
		t.Errorf("conflict: expected [shared.txt], got %d files", len(plan.Conflicts))
	}
}

// TestSyncDirection_Constants tests that sync direction constants are correct.
func TestSyncDirection_Constants(t *testing.T) {
	if SyncUpload != "upload" {
		t.Errorf("SyncUpload = %q, want %q", SyncUpload, "upload")
	}
	if SyncDownload != "download" {
		t.Errorf("SyncDownload = %q, want %q", SyncDownload, "download")
	}
}

// TestFileChange_Fields tests FileChange struct fields.
func TestFileChange_Fields(t *testing.T) {
	now := time.Now()
	fc := FileChange{
		Path:     "test/path",
		Size:     1024,
		Hash:     "abc123",
		Modified: now,
	}
	if fc.Path != "test/path" {
		t.Errorf("Path = %q", fc.Path)
	}
	if fc.Size != 1024 {
		t.Errorf("Size = %d", fc.Size)
	}
	if fc.Hash != "abc123" {
		t.Errorf("Hash = %q", fc.Hash)
	}
	if !fc.Modified.Equal(now) {
		t.Error("Modified time mismatch")
	}
}

// TestFileConflict_Fields tests FileConflict struct fields.
func TestFileConflict_Fields(t *testing.T) {
	now := time.Now()
	fc := FileConflict{
		Path:       "conflict.txt",
		LocalHash:  "local-hash",
		RemoteHash: "remote-hash",
		LocalTime:  now,
		RemoteTime: now.Add(time.Hour),
	}
	if fc.Path != "conflict.txt" {
		t.Errorf("Path = %q", fc.Path)
	}
	if fc.LocalHash != "local-hash" {
		t.Errorf("LocalHash = %q", fc.LocalHash)
	}
	if fc.RemoteHash != "remote-hash" {
		t.Errorf("RemoteHash = %q", fc.RemoteHash)
	}
	if !fc.RemoteTime.After(fc.LocalTime) {
		t.Error("RemoteTime should be after LocalTime")
	}
}