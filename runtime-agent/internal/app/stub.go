//go:build !unwired

// Package app is excluded from default builds (GO-P3-2 / S5).
// Production uses NewMemoryServices + api.Server.routes().
// Build/test the use-case stack with: go test -tags=unwired ./internal/app/...
package app
