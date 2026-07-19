package runtimeplan

import (
	"context"
	"time"
)

type RuntimeInstallation struct {
	ID           string    `json:"id"`
	CatalinaHome string    `json:"catalinaHome"`
	JavaHome     string    `json:"javaHome,omitempty"`
	Version      string    `json:"version"`
	Provider     string    `json:"provider"`
	VerifiedAt   time.Time `json:"verifiedAt"`
}

type RuntimeRegistry interface {
	Get(ctx context.Context, id string) (*RuntimeInstallation, error)
	List(ctx context.Context) ([]RuntimeInstallation, error)
}
