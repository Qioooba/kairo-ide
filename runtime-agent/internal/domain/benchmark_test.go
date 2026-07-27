package domain

import (
	"encoding/json"
	"testing"
	"time"
)

// --- DeploymentOwnerToken benchmarks ---

func BenchmarkNewDeploymentOwnerToken(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewDeploymentOwnerToken("ws-1", "proj-1", "srv-1", "/tmp/root")
	}
}

func BenchmarkDeploymentOwnerToken_Valid(b *testing.B) {
	token := NewDeploymentOwnerToken("ws-1", "proj-1", "srv-1", "/tmp/root")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		token.Valid()
	}
}

func BenchmarkDeploymentOwnerToken_Verify(b *testing.B) {
	token := NewDeploymentOwnerToken("ws-1", "proj-1", "srv-1", "/tmp/root")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		token.Verify("ws-1", "proj-1", "srv-1", "/tmp/root")
	}
}

func BenchmarkDeploymentOwnerToken_Verify_Wrong(b *testing.B) {
	token := NewDeploymentOwnerToken("ws-1", "proj-1", "srv-1", "/tmp/root")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		token.Verify("ws-2", "proj-2", "srv-2", "/tmp/other")
	}
}

// --- ServerState benchmarks ---

func BenchmarkCanTransitionServerState(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CanTransitionServerState(ServerStateRunning, ServerStateStopping)
	}
}

func BenchmarkCanTransitionServerState_Invalid(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CanTransitionServerState(ServerStateStopped, ServerStateRunning)
	}
}

func BenchmarkTransitionServerState(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		TransitionServerState(ServerStateRunning, ServerStateStopping)
	}
}

func BenchmarkServerState_IsTerminal(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ServerStateRunning.IsTerminal()
	}
}

func BenchmarkServerState_IsTransitioning(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ServerStateStarting.IsTransitioning()
	}
}

// --- BuildState benchmarks ---

func BenchmarkBuildState_CanTransitionTo(b *testing.B) {
	s := BuildStateQueued
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.CanTransitionTo(BuildStateRunning)
	}
}

func BenchmarkBuildRun_IsTerminal(b *testing.B) {
	run := BuildRun{State: BuildStateSucceeded}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		run.IsTerminal()
	}
}

// --- DeepCopy benchmarks ---

func BenchmarkBuildRun_DeepCopy(b *testing.B) {
	now := time.Now()
	code := 0
	run := BuildRun{
		ID:          "build-1",
		WorkspaceID: "ws-1",
		ProjectID:   "proj-1",
		State:       BuildStateSucceeded,
		QueuedAt:    now,
		StartedAt:   &now,
		FinishedAt:  &now,
		ExitCode:    &code,
		Summary:     "Build completed",
		Diagnostics: []BuildDiagnostic{
			{File: "src/Main.java", Line: 10, Column: 5, Severity: "warning", Message: "unused variable"},
			{File: "src/Util.java", Line: 20, Column: 3, Severity: "error", Message: "cannot find symbol"},
		},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		run.DeepCopy()
	}
}

func BenchmarkServerRecord_DeepCopy(b *testing.B) {
	now := time.Now()
	pi := ProcessIdentity{
		PID:          12345,
		Executable:   "/usr/bin/java",
		StartTime:    now,
		CatalinaBase: "/tmp/catalina",
		MarkerToken:  "abc123",
	}
	rec := ServerRecord{
		ID:            "srv-1",
		WorkspaceID:   "ws-1",
		ProjectID:     "proj-1",
		DesiredState:  DesiredServerStateRunning,
		ObservedState: ServerStateRunning,
		Generation:    1,
		PID:           12345,
		ProcessIdentity: &pi,
		RuntimePlan: RuntimePlan{
			WorkspaceID:    "ws-1",
			ProjectID:      "proj-1",
			ServerID:       "srv-1",
			RuntimeID:      "tomcat6",
			HTTPPort:       18080,
			ShutdownPort:   8005,
			DebugPort:      5005,
			ContextPath:    "/myapp",
			DeploymentRoot: "/tmp/deploy",
			JVMOptions:     []string{"-Xmx512m", "-Xms256m"},
			Env:            []string{"PATH=/usr/bin", "JAVA_HOME=/usr/java"},
			Generation:     1,
		},
		StartedAt: &now,
		UpdatedAt: now,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rec.DeepCopy()
	}
}

func BenchmarkRuntimePlan_DeepCopy(b *testing.B) {
	plan := RuntimePlan{
		WorkspaceID:    "ws-1",
		ProjectID:      "proj-1",
		ServerID:       "srv-1",
		RuntimeID:      "tomcat6",
		HTTPPort:       18080,
		ShutdownPort:   8005,
		DebugPort:      5005,
		ContextPath:    "/myapp",
		DeploymentRoot: "/tmp/deploy",
		JVMOptions:     []string{"-Xmx512m", "-Xms256m", "-XX:+UseParallelGC"},
		Env:            []string{"PATH=/usr/bin", "JAVA_HOME=/usr/java", "LANG=en_US.UTF-8"},
		Generation:     1,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		plan.DeepCopy()
	}
}

// --- ProcessIdentity benchmarks ---

func BenchmarkProcessIdentity_Equal(b *testing.B) {
	now := time.Now()
	pi1 := ProcessIdentity{
		PID:          12345,
		Executable:   "/usr/bin/java",
		StartTime:    now,
		CatalinaBase: "/tmp/catalina",
		MarkerToken:  "abc123",
	}
	pi2 := ProcessIdentity{
		PID:          12345,
		Executable:   "/usr/bin/java",
		StartTime:    now,
		CatalinaBase: "/tmp/catalina",
		MarkerToken:  "abc123",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		pi1.Equal(pi2)
	}
}

func BenchmarkProcessIdentity_Equal_Different(b *testing.B) {
	now := time.Now()
	pi1 := ProcessIdentity{
		PID:          12345,
		Executable:   "/usr/bin/java",
		StartTime:    now,
		CatalinaBase: "/tmp/catalina",
		MarkerToken:  "abc123",
	}
	pi2 := ProcessIdentity{
		PID:          54321,
		Executable:   "/usr/bin/java",
		StartTime:    now.Add(time.Minute),
		CatalinaBase: "/tmp/other",
		MarkerToken:  "xyz789",
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		pi1.Equal(pi2)
	}
}

// --- Error mapping benchmarks ---

func BenchmarkMapError_Known(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		MapError(ErrNotFound)
	}
}

func BenchmarkMapError_Unknown(b *testing.B) {
	// Use a custom error that won't match any sentinel
	err := NewDomainError("CUSTOM", "custom error", nil)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		MapError(err)
	}
}

// --- Path validation benchmarks ---

func BenchmarkValidateWorkspacePath(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ValidateWorkspacePath("src/main/java/com/example/App.java")
	}
}

func BenchmarkValidateWorkspacePath_Simple(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ValidateWorkspacePath("index.html")
	}
}

func BenchmarkResolveCanonicalPath(b *testing.B) {
	root := b.TempDir()
	wp, _ := ValidateWorkspacePath("src/main/java")
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ResolveCanonicalPath(root, wp)
	}
}

// --- Run configuration benchmarks ---

func BenchmarkDecodeRunConfigurationDocument(b *testing.B) {
	data := []byte(`{
		"version": 1,
		"selectedConfigurationId": "cfg-1",
		"configurations": [{
			"id": "cfg-1",
			"name": "My Config",
			"type": "tomcat6",
			"projectId": "proj-1",
			"mode": "run",
			"suspend": false,
			"jdkRef": "jdk-1",
			"build": {"type": "ant", "target": "dist", "clean": true},
			"server": {"id": "srv-1", "httpPort": 18080, "debugPort": 5005, "contextPath": "/myapp"},
			"deploy": {"mode": "exploded", "artifact": "dist/myapp"},
			"env": {"JAVA_OPTS": "-Xmx512m"},
			"vmOptions": ["-server"],
			"beforeLaunchTasks": ["build", "deploy"]
		}]
	}`)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		DecodeRunConfigurationDocument(data)
	}
}

func BenchmarkTomcatRunConfiguration_Validate(b *testing.B) {
	cfg := TomcatRunConfiguration{
		ID:        "cfg-1",
		Name:      "My Config",
		Type:      "tomcat6",
		ProjectID: "proj-1",
		Mode:      "run",
		Suspend:   false,
		JDKRef:    "jdk-1",
		Build: RunConfigurationBuild{
			Type:   "ant",
			Target: "dist",
			Clean:  true,
		},
		Server: RunConfigurationServer{
			ID:          "srv-1",
			HTTPPort:    18080,
			DebugPort:   5005,
			ContextPath: "/myapp",
		},
		Deploy: RunConfigurationDeploy{
			Mode:     "exploded",
			Artifact: "dist/myapp",
		},
		Env:               map[string]string{"JAVA_OPTS": "-Xmx512m"},
		VMOptions:         []string{"-server"},
		BeforeLaunchTasks: []string{"build", "deploy"},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cfg.Validate()
	}
}

func BenchmarkValidateRunConfigurationID(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ValidateRunConfigurationID("valid-id-123")
	}
}

// --- JSON serialization benchmarks for domain types ---

func BenchmarkJSONMarshal_Workspace(b *testing.B) {
	ws := Workspace{
		ID:         "ws-1",
		Name:       "My Workspace",
		Root:       "/tmp/workspace",
		LastOpened: time.Now(),
		CreatedAt:  time.Now(),
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		json.Marshal(ws)
	}
}

func BenchmarkJSONUnmarshal_Workspace(b *testing.B) {
	data := []byte(`{"id":"ws-1","name":"My Workspace","root":"/tmp/workspace","lastOpened":"2024-01-15T10:30:00Z","createdAt":"2024-01-01T00:00:00Z"}`)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var ws Workspace
		json.Unmarshal(data, &ws)
	}
}

func BenchmarkJSONMarshal_Project(b *testing.B) {
	proj := Project{
		ID:            "proj-1",
		WorkspaceID:   "ws-1",
		Name:          "My Project",
		RootPath:      "/tmp/project",
		Root:          "/tmp/project",
		Config:        ProjectConfig{SchemaVersion: 1, Name: "My Project", SourceRoots: []string{"src"}, BuildTool: "ant"},
		SourceRoots:   []string{"src/main/java"},
		ResourceRoots: []string{"src/main/resources"},
		LibraryDirs:   []string{"lib"},
		WebappDir:     "WebRoot",
		OutputDir:     "dist",
		BuildFile:     "build.xml",
		BuildTargets:  []string{"dist"},
		SourceLevel:   "1.6",
		TargetLevel:   "1.6",
		Encoding:      "UTF-8",
		BuildTool:     "ant",
		ContextPath:   "/myapp",
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		json.Marshal(proj)
	}
}

func BenchmarkJSONMarshal_BuildPlan(b *testing.B) {
	plan := BuildPlan{
		WorkspaceID: "ws-1",
		ProjectID:   "proj-1",
		ProjectRoot: "/tmp/project",
		BuildTool:   "ant",
		BuildFile:   "build.xml",
		Targets:     []string{"dist"},
		SourceRoots: []string{"src/main/java"},
		OutputDir:   "dist",
		Classpath:   []string{"lib/servlet-api.jar", "lib/jsp-api.jar"},
		JavaHome:    "/usr/lib/jvm/java-6",
		SourceLevel: "1.6",
		TargetLevel: "1.6",
		Encoding:    "UTF-8",
		Clean:       true,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		json.Marshal(plan)
	}
}

func BenchmarkJSONMarshal_ServerRecord(b *testing.B) {
	now := time.Now()
	rec := ServerRecord{
		ID:            "srv-1",
		WorkspaceID:   "ws-1",
		ProjectID:     "proj-1",
		DesiredState:  DesiredServerStateRunning,
		ObservedState: ServerStateRunning,
		Generation:    1,
		PID:           12345,
		RuntimePlan: RuntimePlan{
			WorkspaceID:    "ws-1",
			ProjectID:      "proj-1",
			ServerID:       "srv-1",
			RuntimeID:      "tomcat6",
			HTTPPort:       18080,
			ShutdownPort:   8005,
			ContextPath:    "/myapp",
			DeploymentRoot: "/tmp/deploy",
			Generation:     1,
		},
		StartedAt: &now,
		UpdatedAt: now,
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		json.Marshal(rec)
	}
}

// --- PortLease benchmarks ---

func BenchmarkPortLease_Release(b *testing.B) {
	lease := NewPortLease(18080, 8005, 5005, func() {})
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		lease.Release()
		// Re-create after each iteration
		lease = NewPortLease(18080, 8005, 5005, func() {})
	}
}

func BenchmarkNewPortLease(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewPortLease(18080, 8005, 5005, func() {})
	}
}

// --- Error type benchmarks ---

func BenchmarkNewDomainError(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewDomainError("ERR_001", "something went wrong", ErrInternal)
	}
}

func BenchmarkNewValidationError(b *testing.B) {
	fields := map[string]string{"name": "required", "port": "invalid range"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewValidationError("validation failed", fields)
	}
}

func BenchmarkAggregateError_Error(b *testing.B) {
	errs := []error{ErrNotFound, ErrConflict, ErrInvalidInput}
	ae := NewAggregateError(errs)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = ae.Error()
	}
}

// ErrInternal is a sentinel error for testing.
var ErrInternal = &DomainError{Code: "INTERNAL", Message: "internal error"}

// --- UTCNow benchmark ---

func BenchmarkUTCNow(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		UTCNow()
	}
}