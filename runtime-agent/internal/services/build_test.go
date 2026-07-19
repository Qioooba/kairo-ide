package services

import (
	"testing"

	"github.com/kairo-ide/runtime-agent/internal/api"
	"github.com/kairo-ide/runtime-agent/internal/build"
)

func TestAsyncBuildEngineReturnsDetachedSnapshots(t *testing.T) {
	stored := &api.BuildResult{
		ID:    "build-1",
		State: "running",
		Diagnostics: []build.Diagnostic{{
			Message: "original",
		}},
	}
	engine := &asyncBuildEngine{
		finished: map[string]*api.BuildResult{stored.ID: stored},
	}

	got, err := engine.Get(stored.ID)
	if err != nil {
		t.Fatal(err)
	}
	got.State = "corrupted"
	got.Diagnostics[0].Message = "corrupted"

	again, err := engine.Get(stored.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.State != "running" || again.Diagnostics[0].Message != "original" {
		t.Fatalf("Get returned shared state: %+v", again)
	}

	listed := engine.List()
	listed[0].State = "corrupted"
	again, err = engine.Get(stored.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.State != "running" {
		t.Fatalf("List returned shared state: %+v", again)
	}
}
