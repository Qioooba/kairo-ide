package catalinabase

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

func TestWriteAndReadOwner(t *testing.T) {
	tmpDir := t.TempDir()
	baseDir := filepath.Join(tmpDir, "server")
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		t.Fatal(err)
	}

	owner := OwnerMetadata{
		WorkspaceID: domain.WorkspaceID("ws_aaaaaaaaaaaaaaaaaaaaaaaaaa"),
		ProjectID:   domain.ProjectID("prj_bbbbbbbbbbbbbbbbbbbbbbbbbb"),
		ServerID:    domain.ServerID("srv_cccccccccccccccccccccccccc"),
		RuntimeID:   "tomcat6",
	}

	if err := WriteOwner(baseDir, owner); err != nil {
		t.Fatalf("WriteOwner: %v", err)
	}

	read, err := ReadOwner(baseDir)
	if err != nil {
		t.Fatalf("ReadOwner: %v", err)
	}

	if read.WorkspaceID != owner.WorkspaceID {
		t.Errorf("WorkspaceID = %q, want %q", read.WorkspaceID, owner.WorkspaceID)
	}
	if read.ProjectID != owner.ProjectID {
		t.Errorf("ProjectID = %q, want %q", read.ProjectID, owner.ProjectID)
	}
	if read.ServerID != owner.ServerID {
		t.Errorf("ServerID = %q, want %q", read.ServerID, owner.ServerID)
	}
	if read.RuntimeID != owner.RuntimeID {
		t.Errorf("RuntimeID = %q, want %q", read.RuntimeID, owner.RuntimeID)
	}
	if read.SchemaVersion != SchemaVersion {
		t.Errorf("SchemaVersion = %d, want %d", read.SchemaVersion, SchemaVersion)
	}
	if read.CreatedAt.IsZero() {
		t.Error("CreatedAt should not be zero")
	}
}

func TestVerifyOwner(t *testing.T) {
	tmpDir := t.TempDir()
	baseDir := filepath.Join(tmpDir, "server")
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		t.Fatal(err)
	}

	owner := OwnerMetadata{
		WorkspaceID: domain.WorkspaceID("ws_aaaaaaaaaaaaaaaaaaaaaaaaaa"),
		ProjectID:   domain.ProjectID("prj_bbbbbbbbbbbbbbbbbbbbbbbbbb"),
		ServerID:    domain.ServerID("srv_cccccccccccccccccccccccccc"),
		RuntimeID:   "tomcat6",
	}

	if err := VerifyOwner(baseDir, owner); err != nil {
		t.Errorf("VerifyOwner on empty dir should succeed, got %v", err)
	}

	if err := WriteOwner(baseDir, owner); err != nil {
		t.Fatal(err)
	}

	if err := VerifyOwner(baseDir, owner); err != nil {
		t.Errorf("VerifyOwner matching should succeed, got %v", err)
	}

	wrongOwner := owner
	wrongOwner.ProjectID = domain.ProjectID("prj_dddddddddddddddddddddddddd")
	if err := VerifyOwner(baseDir, wrongOwner); err == nil {
		t.Error("VerifyOwner with mismatched project should fail")
	}

	wrongOwner2 := owner
	wrongOwner2.ServerID = domain.ServerID("srv_eeeeeeeeeeeeeeeeeeeeeeeeee")
	if err := VerifyOwner(baseDir, wrongOwner2); err == nil {
		t.Error("VerifyOwner with mismatched server should fail")
	}
}

func TestOwnerMismatchErrorIsDomainError(t *testing.T) {
	tmpDir := t.TempDir()
	baseDir := filepath.Join(tmpDir, "server")
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		t.Fatal(err)
	}

	owner := OwnerMetadata{
		WorkspaceID: domain.WorkspaceID("ws_aaaaaaaaaaaaaaaaaaaaaaaaaa"),
		ProjectID:   domain.ProjectID("prj_bbbbbbbbbbbbbbbbbbbbbbbbbb"),
		ServerID:    domain.ServerID("srv_cccccccccccccccccccccccccc"),
		RuntimeID:   "tomcat6",
	}
	WriteOwner(baseDir, owner)

	wrong := owner
	wrong.WorkspaceID = domain.WorkspaceID("ws_xxxxxxxxxxxxxxxxxxxxxxxxxx")
	err := VerifyOwner(baseDir, wrong)
	if err == nil {
		t.Fatal("expected error")
	}
	if !errorIs(err, domain.ErrDeploymentTargetMismatch) {
		t.Errorf("error should wrap ErrDeploymentTargetMismatch, got %v", err)
	}
}

func TestPrepare(t *testing.T) {
	tmpDir := t.TempDir()
	preparer := NewDefaultPreparer()
	planner := NewDefaultPlanner()

	owner := OwnerMetadata{
		WorkspaceID: domain.WorkspaceID("ws_aaaaaaaaaaaaaaaaaaaaaaaaaa"),
		ProjectID:   domain.ProjectID("prj_bbbbbbbbbbbbbbbbbbbbbbbbbb"),
		ServerID:    domain.ServerID("srv_cccccccccccccccccccccccccc"),
		RuntimeID:   "tomcat6",
	}

	plan, err := planner.Plan(tmpDir, owner, "myapp")
	if err != nil {
		t.Fatal(err)
	}

	if err := preparer.Prepare(plan); err != nil {
		t.Fatalf("Prepare: %v", err)
	}

	for _, dir := range plan.Layout.RequiredDirs() {
		info, err := os.Stat(dir)
		if err != nil {
			t.Errorf("dir %s should exist: %v", dir, err)
			continue
		}
		if !info.IsDir() {
			t.Errorf("%s should be a directory", dir)
		}
	}

	ownerPath := filepath.Join(plan.Layout.BaseDir, "owner.json")
	data, err := os.ReadFile(ownerPath)
	if err != nil {
		t.Fatalf("read owner.json: %v", err)
	}
	var readMeta OwnerMetadata
	if err := json.Unmarshal(data, &readMeta); err != nil {
		t.Fatalf("parse owner.json: %v", err)
	}
	if !readMeta.Matches(owner) {
		t.Errorf("owner metadata mismatch")
	}
}

func TestSafeRemove(t *testing.T) {
	tmpDir := t.TempDir()
	preparer := NewDefaultPreparer()
	planner := NewDefaultPlanner()

	owner := OwnerMetadata{
		WorkspaceID: domain.WorkspaceID("ws_aaaaaaaaaaaaaaaaaaaaaaaaaa"),
		ProjectID:   domain.ProjectID("prj_bbbbbbbbbbbbbbbbbbbbbbbbbb"),
		ServerID:    domain.ServerID("srv_cccccccccccccccccccccccccc"),
		RuntimeID:   "tomcat6",
	}

	plan, err := planner.Plan(tmpDir, owner, "myapp")
	if err != nil {
		t.Fatal(err)
	}
	if err := preparer.Prepare(plan); err != nil {
		t.Fatal(err)
	}

	wrongOwner := owner
	wrongOwner.ServerID = domain.ServerID("srv_xxxxxxxxxxxxxxxxxxxxxxxxxx")
	if err := SafeRemove(plan.Layout.BaseDir, wrongOwner); err == nil {
		t.Error("SafeRemove with wrong owner should fail")
	}

	if _, err := os.Stat(plan.Layout.BaseDir); err != nil {
		t.Error("base dir should still exist after failed SafeRemove")
	}

	if err := SafeRemove(plan.Layout.BaseDir, owner); err != nil {
		t.Fatalf("SafeRemove with correct owner: %v", err)
	}

	if _, err := os.Stat(plan.Layout.BaseDir); !os.IsNotExist(err) {
		t.Error("base dir should be removed")
	}
}

func errorIs(err, target error) bool {
	for {
		if err == target {
			return true
		}
		if u, ok := err.(interface{ Unwrap() error }); ok {
			err = u.Unwrap()
			if err == nil {
				return false
			}
			continue
		}
		if u, ok := err.(interface{ Unwrap() []error }); ok {
			for _, e := range u.Unwrap() {
				if errorIs(e, target) {
					return true
				}
			}
		}
		return false
	}
}
