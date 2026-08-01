package catalinabase

import (
	"os"
	"testing"
)

func TestLayout_Exists(t *testing.T) {
	dataRoot := t.TempDir()
	layout := NewLayout(dataRoot, "srv_1")

	if layout.Exists() {
		t.Error("expected Exists=false before directory creation")
	}

	if err := os.MkdirAll(layout.BaseDir, 0755); err != nil {
		t.Fatal(err)
	}
	if !layout.Exists() {
		t.Error("expected Exists=true after directory creation")
	}
}

func TestLayout_RequiredDirs(t *testing.T) {
	layout := NewLayout(t.TempDir(), "srv_1")
	if len(layout.RequiredDirs()) != 7 {
		t.Errorf("expected 7 required dirs, got %d", len(layout.RequiredDirs()))
	}
}
