//go:build unwired

// Package app holds typed use-case orchestration (build / deploy / server).
//
// GO-P3-2 / S5: excluded from default builds via //go:build unwired.
// Production traffic uses services via NewMemoryServices + api.Server.routes().
// Build/test with: go test -tags=unwired ./internal/app/... ./internal/api/...
package app
