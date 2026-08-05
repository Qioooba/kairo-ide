//go:build unwired

package api

import (
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/app"
)

func TestToDeploymentResponse(t *testing.T) {
	t.Run("nil result", func(t *testing.T) {
		resp := ToDeploymentResponse(nil)
		if resp.ID != "" {
			t.Errorf("ID = %q, want empty", resp.ID)
		}
	})

	t.Run("valid result", func(t *testing.T) {
		result := &app.DeployResult{
			ID:        "dep-1",
			ProjectID: "proj-1",
			BuildID:   "build-1",
			State:     "success",
			Succeeded: 10,
			Modified:  5,
			Deleted:   2,
			Bytes:     1024,
			Error:     "",
		}
		resp := ToDeploymentResponse(result)
		if resp.ID != "dep-1" {
			t.Errorf("ID = %q, want dep-1", resp.ID)
		}
		if resp.Added != 10 {
			t.Errorf("Added = %d, want 10", resp.Added)
		}
		if resp.Modified != 5 {
			t.Errorf("Modified = %d, want 5", resp.Modified)
		}
		if resp.Deleted != 2 {
			t.Errorf("Deleted = %d, want 2", resp.Deleted)
		}
		if resp.Bytes != 1024 {
			t.Errorf("Bytes = %d, want 1024", resp.Bytes)
		}
		if resp.State != "success" {
			t.Errorf("State = %q, want success", resp.State)
		}
	})

	t.Run("error result", func(t *testing.T) {
		result := &app.DeployResult{
			ID:    "dep-2",
			State: "failed",
			Error: "deployment failed",
		}
		resp := ToDeploymentResponse(result)
		if resp.Error != "deployment failed" {
			t.Errorf("Error = %q, want 'deployment failed'", resp.Error)
		}
	})
}
