package catalinabase

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/domain"
)

func TestNormalizeContextPath(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantContext string
		wantDir     string
		wantErr     bool
	}{
		{"empty", "", "/", "ROOT", false},
		{"root slash", "/", "/", "ROOT", false},
		{"simple app", "myapp", "/myapp", "myapp", false},
		{"leading slash", "/myapp", "/myapp", "myapp", false},
		{"trailing slash", "myapp/", "/myapp", "myapp", false},
		{"nested", "foo/bar", "/foo/bar", "foo/bar", false},
		{"traversal ../", "../etc", "", "", true},
		{"traversal inside", "foo/../bar", "", "", true},
		{"traversal backslash", `foo\..\bar`, "", "", true},
		{"ends with dot", "myapp.", "", "", true},
		{"ends with space", "myapp ", "", "", true},
		{"CON reserved", "CON", "", "", true},
		{"con lowercase", "con", "", "", true},
		{"NUL reserved", "NUL", "", "", true},
		{"COM1 reserved", "COM1", "", "", true},
		{"LPT1 reserved", "LPT1", "", "", true},
		{"colon invalid", "my:app", "", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, dir, err := NormalizeContextPath(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("NormalizeContextPath(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
				return
			}
			if err != nil {
				return
			}
			if ctx != tt.wantContext {
				t.Errorf("NormalizeContextPath(%q) context = %q, want %q", tt.input, ctx, tt.wantContext)
			}
			if dir != tt.wantDir {
				t.Errorf("NormalizeContextPath(%q) dir = %q, want %q", tt.input, dir, tt.wantDir)
			}
		})
	}
}

func TestPlan(t *testing.T) {
	tmpDir := t.TempDir()
	planner := NewDefaultPlanner()

	owner := OwnerMetadata{
		WorkspaceID: domain.WorkspaceID("ws_aaaaaaaaaaaaaaaaaaaaaaaaaa"),
		ProjectID:   domain.ProjectID("prj_bbbbbbbbbbbbbbbbbbbbbbbbbb"),
		ServerID:    domain.ServerID("srv_cccccccccccccccccccccccccc"),
		RuntimeID:   "tomcat6",
	}

	plan, err := planner.Plan(tmpDir, owner, "myapp")
	if err != nil {
		t.Fatalf("Plan: %v", err)
	}

	if plan.ContextPath != "/myapp" {
		t.Errorf("ContextPath = %q, want /myapp", plan.ContextPath)
	}
	if plan.WebappDirName != "myapp" {
		t.Errorf("WebappDirName = %q, want myapp", plan.WebappDirName)
	}
	expectedBase := filepath.Join(tmpDir, "runtime", "servers", "srv_cccccccccccccccccccccccccc")
	if plan.Layout.BaseDir != expectedBase {
		t.Errorf("BaseDir = %q, want %q", plan.Layout.BaseDir, expectedBase)
	}
	expectedDeploy := filepath.Join(expectedBase, "webapps", "myapp")
	if plan.DeploymentRoot != expectedDeploy {
		t.Errorf("DeploymentRoot = %q, want %q", plan.DeploymentRoot, expectedDeploy)
	}

	if plan.Layout.ConfDir != filepath.Join(expectedBase, "conf") {
		t.Errorf("ConfDir wrong")
	}
	if plan.Layout.LogsDir != filepath.Join(expectedBase, "logs") {
		t.Errorf("LogsDir wrong")
	}
}

func TestPlanROOT(t *testing.T) {
	tmpDir := t.TempDir()
	planner := NewDefaultPlanner()

	owner := OwnerMetadata{
		WorkspaceID: domain.WorkspaceID("ws_aaaaaaaaaaaaaaaaaaaaaaaaaa"),
		ProjectID:   domain.ProjectID("prj_bbbbbbbbbbbbbbbbbbbbbbbbbb"),
		ServerID:    domain.ServerID("srv_cccccccccccccccccccccccccc"),
		RuntimeID:   "tomcat6",
	}

	plan, err := planner.Plan(tmpDir, owner, "/")
	if err != nil {
		t.Fatalf("Plan: %v", err)
	}

	if plan.ContextPath != "/" {
		t.Errorf("ContextPath = %q, want /", plan.ContextPath)
	}
	if plan.WebappDirName != "ROOT" {
		t.Errorf("WebappDirName = %q, want ROOT", plan.WebappDirName)
	}
	if !strings.HasSuffix(plan.DeploymentRoot, string(filepath.Separator)+"ROOT") {
		t.Errorf("DeploymentRoot should end with ROOT, got %q", plan.DeploymentRoot)
	}
}

func TestPlanErrors(t *testing.T) {
	tmpDir := t.TempDir()
	planner := NewDefaultPlanner()

	_, err := planner.Plan("", OwnerMetadata{}, "myapp")
	if err == nil {
		t.Error("expected error for empty data root")
	}

	_, err = planner.Plan(tmpDir, OwnerMetadata{}, "myapp")
	if err == nil {
		t.Error("expected error for empty server id")
	}

	owner := OwnerMetadata{
		WorkspaceID: domain.WorkspaceID("ws_aaaaaaaaaaaaaaaaaaaaaaaaaa"),
		ProjectID:   domain.ProjectID("prj_bbbbbbbbbbbbbbbbbbbbbbbbbb"),
		ServerID:    domain.ServerID("srv_cccccccccccccccccccccccccc"),
	}
	_, err = planner.Plan(tmpDir, owner, "myapp")
	if err == nil {
		t.Error("expected error for empty runtime id")
	}
}
