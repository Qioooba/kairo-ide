//go:build unwired

package api

import (
	"testing"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/app"
)

func BenchmarkToDeploymentResponse(b *testing.B) {
	result := &app.DeployResult{
		ID:        "dep-1",
		ProjectID: "proj-1",
		BuildID:   "build-1",
		State:     "completed",
		Succeeded: 42,
		Modified:  5,
		Deleted:   0,
		Bytes:     102400,
		Error:     "",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ToDeploymentResponse(result)
	}
}
