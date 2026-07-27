package deploy

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// --- Packaging benchmarks ---

func BenchmarkPackageArchive(b *testing.B) {
	dir := b.TempDir()
	srcDir := filepath.Join(dir, "source")
	os.MkdirAll(srcDir, 0755)
	for i := 0; i < 100; i++ {
		os.WriteFile(filepath.Join(srcDir, "file"+string(rune('A'+i%26))+".txt"), []byte("content\n"), 0644)
	}
	subDir := filepath.Join(srcDir, "WEB-INF")
	os.MkdirAll(subDir, 0755)
	for i := 0; i < 50; i++ {
		os.WriteFile(filepath.Join(subDir, "lib-"+string(rune('A'+i%26))+".jar"), []byte("jar content"), 0644)
	}

	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		outPath := filepath.Join(dir, "output.war")
		_, err := PackageArchive(ctx, PackageRequest{
			Type:       PackageTypeWAR,
			SourceDir:  srcDir,
			OutputPath: outPath,
		})
		if err != nil {
			b.Fatal(err)
		}
		os.Remove(outPath)
	}
}

func BenchmarkPackageArchive_Large(b *testing.B) {
	dir := b.TempDir()
	srcDir := filepath.Join(dir, "source")
	os.MkdirAll(srcDir, 0755)
	for i := 0; i < 500; i++ {
		os.WriteFile(filepath.Join(srcDir, "file"+string(rune('A'+i%26))+".txt"), []byte("content\n"), 0644)
	}
	subDir := filepath.Join(srcDir, "WEB-INF")
	os.MkdirAll(subDir, 0755)
	classesDir := filepath.Join(subDir, "classes")
	os.MkdirAll(classesDir, 0755)
	for i := 0; i < 200; i++ {
		os.WriteFile(filepath.Join(classesDir, "Class"+string(rune('A'+i%26))+".class"), []byte("class content"), 0644)
	}

	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		outPath := filepath.Join(dir, "output.war")
		_, err := PackageArchive(ctx, PackageRequest{
			Type:       PackageTypeWAR,
			SourceDir:  srcDir,
			OutputPath: outPath,
		})
		if err != nil {
			b.Fatal(err)
		}
		os.Remove(outPath)
	}
}

func BenchmarkHotDeploy(b *testing.B) {
	dir := b.TempDir()
	srcDir := filepath.Join(dir, "source")
	deployDir := filepath.Join(dir, "deploy")
	os.MkdirAll(srcDir, 0755)
	os.MkdirAll(deployDir, 0755)

	changedFiles := make([]string, 50)
	for i := range changedFiles {
		p := filepath.Join(srcDir, "file"+string(rune('A'+i%26))+".txt")
		os.WriteFile(p, []byte("content"), 0644)
		changedFiles[i] = p
	}

	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := HotDeploy(ctx, HotDeployRequest{
			DeploymentRoot: deployDir,
			ChangedFiles:   changedFiles,
			SourceRoots:    []string{srcDir},
		})
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkCopyFile(b *testing.B) {
	dir := b.TempDir()
	src := filepath.Join(dir, "source.txt")
	dst := filepath.Join(dir, "dest.txt")
	os.WriteFile(src, []byte("hello world benchmark content"), 0644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		os.Remove(dst)
		copyFile(src, dst)
	}
}

func BenchmarkFindRelativePath(b *testing.B) {
	sourceRoots := []string{"/project/src", "/project/webapp", "/project/resources"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		findRelativePath("/project/src/com/example/Main.java", sourceRoots)
	}
}

func BenchmarkFindRelativePath_NotFound(b *testing.B) {
	sourceRoots := []string{"/project/src", "/project/webapp"}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		findRelativePath("/other/File.java", sourceRoots)
	}
}

func BenchmarkResolveDeployTarget(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ResolveDeployTarget("/opt/tomcat/instance", "/myapp")
	}
}

func BenchmarkResolveDeployTarget_ROOT(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		ResolveDeployTarget("/opt/tomcat/instance", "/")
	}
}

func BenchmarkIsValidDeployMode(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		IsValidDeployMode("merge")
	}
}

func BenchmarkDeployModeDescription(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		DeployModeDescription("merge")
	}
}

// --- DeployTracker benchmarks ---

func BenchmarkDeployTracker_Track(b *testing.B) {
	tracker := NewDeployTracker()
	dep := &TrackedDeployment{
		ID:          "dep-1",
		WorkspaceID: "ws-1",
		ProjectID:   "proj-1",
		Status:      DeployStatusPending,
		StartedAt:   time.Now(),
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		dep.ID = "dep-" + string(rune('A'+i%26))
		tracker.Track(dep)
	}
}

func BenchmarkDeployTracker_Get(b *testing.B) {
	tracker := NewDeployTracker()
	dep := &TrackedDeployment{
		ID:          "dep-1",
		WorkspaceID: "ws-1",
		ProjectID:   "proj-1",
		Status:      DeployStatusPending,
		StartedAt:   time.Now(),
	}
	tracker.Track(dep)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tracker.Get("dep-1")
	}
}

func BenchmarkDeployTracker_List(b *testing.B) {
	tracker := NewDeployTracker()
	for i := 0; i < 100; i++ {
		tracker.Track(&TrackedDeployment{
			ID:          "dep-" + string(rune('A'+i%26)),
			WorkspaceID: "ws-1",
			ProjectID:   "proj-1",
			Status:      DeployStatusPending,
			StartedAt:   time.Now(),
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tracker.List()
	}
}

func BenchmarkDeployTracker_ListByProject(b *testing.B) {
	tracker := NewDeployTracker()
	for i := 0; i < 100; i++ {
		tracker.Track(&TrackedDeployment{
			ID:          "dep-" + string(rune('A'+i%26)),
			WorkspaceID: "ws-1",
			ProjectID:   "proj-1",
			Status:      DeployStatusPending,
			StartedAt:   time.Now(),
		})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tracker.ListByProject("ws-1", "proj-1")
	}
}

func BenchmarkDeployTracker_UpdateStatus(b *testing.B) {
	tracker := NewDeployTracker()
	dep := &TrackedDeployment{
		ID:          "dep-1",
		WorkspaceID: "ws-1",
		ProjectID:   "proj-1",
		Status:      DeployStatusPending,
		StartedAt:   time.Now(),
	}
	tracker.Track(dep)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tracker.UpdateStatus("dep-1", DeployStatusCompleted, "")
		tracker.UpdateStatus("dep-1", DeployStatusPending, "")
	}
}

func BenchmarkNewDeployTracker(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewDeployTracker()
	}
}

func BenchmarkNewRollbackEngine(b *testing.B) {
	tracker := NewDeployTracker()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		NewRollbackEngine(tracker)
	}
}

func BenchmarkCreateSnapshot(b *testing.B) {
	dir := b.TempDir()
	deployDir := filepath.Join(dir, "deploy")
	os.MkdirAll(deployDir, 0755)
	files := make([]string, 20)
	for i := range files {
		p := filepath.Join(deployDir, "file"+string(rune('A'+i%26))+".txt")
		os.WriteFile(p, []byte("content"), 0644)
		files[i] = "file" + string(rune('A'+i%26)) + ".txt"
	}

	ctx := context.Background()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		CreateSnapshot(ctx, deployDir, files)
	}
}