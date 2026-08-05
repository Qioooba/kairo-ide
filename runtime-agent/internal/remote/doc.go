//go:build !remote

// Package remote is excluded from default builds (GO-P3-1 / S5).
//
// High-privilege SSH/docker/podman code lives here for a future remote
// Linux agent path. Build with -tags remote to compile and test this
// package; default CI and release binaries omit it entirely.
package remote
