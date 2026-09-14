package build

import (
	"os"
	"path/filepath"
	"testing"
)

// Helper to make class bytes with specific binary class name and major version.
func makeClassBytesWithName(binaryName string, majorVersion int) []byte {
	internalName := []byte(binaryName)
	for i, b := range internalName {
		if b == '.' {
			internalName[i] = '/'
		}
	}

	data := []byte{
		0xCA, 0xFE, 0xBA, 0xBE, // magic
		0x00, 0x00, // minor_version
		byte(majorVersion >> 8), byte(majorVersion & 0xFF), // major_version
		0x00, 0x04, // constant_pool_count: 3 entries (1, 2, 3)
		0x07,       // [1] CONSTANT_Class
		0x00, 0x02, // name_index = 2
		0x01,       // [2] CONSTANT_Utf8
	}
	// append length and bytes for this class
	data = append(data, byte(len(internalName)>>8), byte(len(internalName)&0xFF))
	data = append(data, internalName...)

	// [3] CONSTANT_Class for Object (super class)
	data = append(data, 0x07, 0x00, 0x02)

	// access_flags (public)
	data = append(data, 0x00, 0x01)
	// this_class (index 1)
	data = append(data, 0x00, 0x01)
	// super_class (index 3)
	data = append(data, 0x00, 0x03)
	// interfaces_count, fields_count, methods_count, attributes_count = 0
	data = append(data, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)

	return data
}

// PR04 (F05 / T12): Different packages with same basename Foo.java must be disambiguated.
func TestManifest_DisambiguateSameBaseNameDifferentPackages_T12(t *testing.T) {
	tmp := t.TempDir()
	outDir := filepath.Join(tmp, "out")
	srcDir := filepath.Join(tmp, "src")

	pkgA := filepath.Join(outDir, "com", "example", "a")
	pkgB := filepath.Join(outDir, "com", "example", "b")
	if err := os.MkdirAll(pkgA, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(pkgB, 0o755); err != nil {
		t.Fatal(err)
	}

	srcA := filepath.Join(srcDir, "com", "example", "a", "Foo.java")
	srcB := filepath.Join(srcDir, "com", "example", "b", "Foo.java")
	_ = os.MkdirAll(filepath.Dir(srcA), 0o755)
	_ = os.MkdirAll(filepath.Dir(srcB), 0o755)
	_ = os.WriteFile(srcA, []byte("package com.example.a; public class Foo {}"), 0o644)
	_ = os.WriteFile(srcB, []byte("package com.example.b; public class Foo {}"), 0o644)

	classFileA := filepath.Join(pkgA, "Foo.class")
	classFileB := filepath.Join(pkgB, "Foo.class")
	if err := os.WriteFile(classFileA, makeClassBytesWithName("com.example.a.Foo", 50), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(classFileB, makeClassBytesWithName("com.example.b.Foo", 50), 0o644); err != nil {
		t.Fatal(err)
	}

	manifest, err := GenerateManifest(outDir, srcDir, "proj-1", nil)
	if err != nil {
		t.Fatalf("GenerateManifest failed: %v", err)
	}

	// Lookup for srcB must resolve strictly to com.example.b.Foo, NOT com.example.a.Foo
	artifactsB := manifest.FindArtifactsForSource(srcB)
	if len(artifactsB) != 1 {
		t.Fatalf("expected 1 artifact for srcB, got %d", len(artifactsB))
	}
	if artifactsB[0].BinaryName != "com.example.b.Foo" {
		t.Errorf("binaryName = %q, want com.example.b.Foo", artifactsB[0].BinaryName)
	}
	if artifactsB[0].ArtifactPath != classFileB {
		t.Errorf("artifactPath = %q, want %q", artifactsB[0].ArtifactPath, classFileB)
	}

	// Lookup for srcA must resolve strictly to com.example.a.Foo
	artifactsA := manifest.FindArtifactsForSource(srcA)
	if len(artifactsA) != 1 {
		t.Fatalf("expected 1 artifact for srcA, got %d", len(artifactsA))
	}
	if artifactsA[0].BinaryName != "com.example.a.Foo" {
		t.Errorf("binaryName = %q, want com.example.a.Foo", artifactsA[0].BinaryName)
	}
}

// PR04 (F05 / T13): Anonymous and inner classes must be tracked and deletions recognized.
func TestManifest_AnonymousAndInnerClasses_RemovedTracking_T13(t *testing.T) {
	tmp := t.TempDir()
	outDir := filepath.Join(tmp, "out")
	srcDir := filepath.Join(tmp, "src")
	pkg := filepath.Join(outDir, "com", "example")
	_ = os.MkdirAll(pkg, 0o755)

	srcFile := filepath.Join(srcDir, "com", "example", "Bar.java")
	_ = os.MkdirAll(filepath.Dir(srcFile), 0o755)
	_ = os.WriteFile(srcFile, []byte("package com.example; public class Bar { class Inner {} }"), 0o644)

	// Step 1: Initial compile generates Bar.class, Bar$Inner.class, Bar$1.class
	barClass := filepath.Join(pkg, "Bar.class")
	barInner := filepath.Join(pkg, "Bar$Inner.class")
	barAnon := filepath.Join(pkg, "Bar$1.class")
	_ = os.WriteFile(barClass, makeClassBytesWithName("com.example.Bar", 50), 0o644)
	_ = os.WriteFile(barInner, makeClassBytesWithName("com.example.Bar$Inner", 50), 0o644)
	_ = os.WriteFile(barAnon, makeClassBytesWithName("com.example.Bar$1", 50), 0o644)

	manifest1, err := GenerateManifest(outDir, srcDir, "proj-1", nil)
	if err != nil {
		t.Fatalf("initial manifest failed: %v", err)
	}
	artifacts := manifest1.FindArtifactsForSource(srcFile)
	if len(artifacts) != 3 {
		t.Fatalf("expected 3 artifacts (top-level + inner + anon), got %d", len(artifacts))
	}

	// Step 2: User removes anonymous class Bar$1. Recompile removes Bar$1.class
	_ = os.Remove(barAnon)

	manifest2, err := GenerateManifest(outDir, srcDir, "proj-1", manifest1)
	if err != nil {
		t.Fatalf("second manifest failed: %v", err)
	}
	if len(manifest2.RemovedArtifacts) != 1 {
		t.Fatalf("expected 1 removed artifact, got %v", manifest2.RemovedArtifacts)
	}
	if manifest2.RemovedArtifacts[0] != "com.example.Bar$1" {
		t.Errorf("removed artifact = %q, want com.example.Bar$1", manifest2.RemovedArtifacts[0])
	}
}

// PR04 (F05 / T14): Artifact overwritten externally must fail hash verification.
func TestManifest_HashMismatchRejection_T14(t *testing.T) {
	tmp := t.TempDir()
	outDir := filepath.Join(tmp, "out")
	srcDir := filepath.Join(tmp, "src")
	pkg := filepath.Join(outDir, "com", "example")
	_ = os.MkdirAll(pkg, 0o755)

	srcFile := filepath.Join(srcDir, "com", "example", "Baz.java")
	_ = os.MkdirAll(filepath.Dir(srcFile), 0o755)
	_ = os.WriteFile(srcFile, []byte("package com.example; public class Baz {}"), 0o644)

	classFile := filepath.Join(pkg, "Baz.class")
	initialBytes := makeClassBytesWithName("com.example.Baz", 50)
	_ = os.WriteFile(classFile, initialBytes, 0o644)

	manifest, err := GenerateManifest(outDir, srcDir, "proj-1", nil)
	if err != nil {
		t.Fatalf("manifest failed: %v", err)
	}
	art := manifest.FindArtifactsForSource(srcFile)
	if len(art) != 1 {
		t.Fatalf("expected 1 artifact, got %d", len(art))
	}

	// Verify initial validation succeeds
	if err := manifest.VerifyArtifactOnDisk(art[0]); err != nil {
		t.Fatalf("initial verification should succeed: %v", err)
	}

	// External process tampers with Baz.class
	_ = os.WriteFile(classFile, []byte("TAMPERED_CLASS_FILE_BYTES"), 0o644)

	// Verify disk check now fails with hash mismatch
	err = manifest.VerifyArtifactOnDisk(art[0])
	if err == nil {
		t.Fatal("expected hash mismatch error after file tampering, but verification passed!")
	}
}

func TestManifest_BadClassSkippedAndBuildIDDeterministic(t *testing.T) {
	tmp := t.TempDir()
	outDir := filepath.Join(tmp, "out")
	srcDir := filepath.Join(tmp, "src")
	pkg := filepath.Join(outDir, "com", "example")
	_ = os.MkdirAll(pkg, 0o755)

	validClass := filepath.Join(pkg, "Good.class")
	_ = os.WriteFile(validClass, makeClassBytesWithName("com.example.Good", 50), 0o644)

	badClass := filepath.Join(pkg, "Corrupt.class")
	_ = os.WriteFile(badClass, []byte("NOT_A_VALID_CLASS"), 0o644)

	manifest1, err := GenerateManifest(outDir, srcDir, "proj-1", nil)
	if err != nil {
		t.Fatalf("GenerateManifest should not fail on bad class, got: %v", err)
	}

	if len(manifest1.Artifacts) != 1 {
		t.Fatalf("expected 1 valid artifact, got %d", len(manifest1.Artifacts))
	}
	if manifest1.Artifacts[0].BinaryName != "com.example.Good" {
		t.Errorf("artifact = %q, want com.example.Good", manifest1.Artifacts[0].BinaryName)
	}
	if len(manifest1.SkippedArtifacts) != 1 {
		t.Fatalf("expected 1 skipped artifact, got %d", len(manifest1.SkippedArtifacts))
	}
	if manifest1.SkippedArtifacts[0] != badClass {
		t.Errorf("skipped = %q, want %q", manifest1.SkippedArtifacts[0], badClass)
	}

	// Deterministic BuildID test
	manifest2, err := GenerateManifest(outDir, srcDir, "proj-1", nil)
	if err != nil {
		t.Fatalf("second GenerateManifest failed: %v", err)
	}
	if manifest1.BuildID != manifest2.BuildID {
		t.Errorf("BuildID not deterministic: %q vs %q", manifest1.BuildID, manifest2.BuildID)
	}
}

func TestPathToURI(t *testing.T) {
	if pathToURI("") != "" {
		t.Errorf("expected empty string for empty path")
	}

	uri1 := pathToURI("C:\\foo\\bar\\Baz.java")
	if uri1 != "file:///c:/foo/bar/Baz.java" {
		t.Errorf("pathToURI(C:\\foo\\bar\\Baz.java) = %q, want file:///c:/foo/bar/Baz.java", uri1)
	}

	uri2 := pathToURI("/home/user/code/Baz.java")
	if uri2 != "file:///home/user/code/Baz.java" {
		t.Errorf("pathToURI(/home/user/code/Baz.java) = %q, want file:///home/user/code/Baz.java", uri2)
	}
}

