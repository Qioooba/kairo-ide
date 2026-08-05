//go:build unwired

package api

import "github.com/Qioooba/kairo-ide/runtime-agent/internal/app"

// ToDeploymentResponse converts an app.DeployResult to a DeploymentResponse DTO.
// Only used by the unwired APIHandler (GO-P3-2).
func ToDeploymentResponse(result *app.DeployResult) DeploymentResponse {
	if result == nil {
		return DeploymentResponse{}
	}
	return DeploymentResponse{
		ID:        result.ID,
		ProjectID: result.ProjectID,
		BuildID:   result.BuildID,
		State:     result.State,
		Added:     result.Succeeded,
		Modified:  result.Modified,
		Deleted:   result.Deleted,
		Bytes:     result.Bytes,
		Error:     result.Error,
	}
}
