package debug

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestJNISignatureFromBinaryName(t *testing.T) {
	got := JNISignatureFromBinaryName("com.example.Foo")
	want := "Lcom/example/Foo;"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestResolveClassFile_ByClassName(t *testing.T) {
	root := t.TempDir()
	pkg := filepath.Join(root, "com", "example")
	if err := os.MkdirAll(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	classFile := filepath.Join(pkg, "Foo.class")
	if err := os.WriteFile(classFile, makeMinimalClassBytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	got, name, err := ResolveClassFile(root, "", "com.example.Foo")
	if err != nil {
		t.Fatal(err)
	}
	if name != "com.example.Foo" {
		t.Fatalf("name = %q", name)
	}
	if got != classFile {
		t.Fatalf("file = %q want %q", got, classFile)
	}
}

func TestResolveClassFile_BySourceWalk(t *testing.T) {
	root := t.TempDir()
	pkg := filepath.Join(root, "com", "example")
	if err := os.MkdirAll(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	classFile := filepath.Join(pkg, "Bar.class")
	if err := os.WriteFile(classFile, makeMinimalClassBytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	got, name, err := ResolveClassFile(root, "src/com/example/Bar.java", "")
	if err != nil {
		t.Fatal(err)
	}
	if name != "com.example.Bar" {
		t.Fatalf("name = %q", name)
	}
	if got != classFile {
		t.Fatalf("file = %q want %q", got, classFile)
	}
}

func TestBuildRedefineClassesCommand_WireFormat(t *testing.T) {
	classBytes := makeMinimalClassBytes()
	data := BuildRedefineClassesCommand([]ClassRedefinition{{
		RefTypeID:  0x42,
		ClassBytes: classBytes,
	}})
	r := NewJDWPDataReader(data)
	count, _ := r.ReadInt()
	if count != 1 {
		t.Fatalf("count=%d", count)
	}
	id, _ := r.ReadObjectID()
	if id != 0x42 {
		t.Fatalf("id=%d", id)
	}
	n, _ := r.ReadInt()
	if int(n) != len(classBytes) {
		t.Fatalf("bytes=%d", n)
	}
}

func TestDialJDWP_InvalidPort(t *testing.T) {
	_, err := DialJDWP("127.0.0.1", 0, 0)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestResolveClassFile_DisambiguateMultiplePackages_T12(t *testing.T) {
	root := t.TempDir()
	pkgA := filepath.Join(root, "com", "example", "pkgA")
	pkgB := filepath.Join(root, "com", "example", "pkgB")
	if err := os.MkdirAll(pkgA, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(pkgB, 0o755); err != nil {
		t.Fatal(err)
	}
	classFileA := filepath.Join(pkgA, "Worker.class")
	classFileB := filepath.Join(pkgB, "Worker.class")
	if err := os.WriteFile(classFileA, makeMinimalClassBytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(classFileB, makeMinimalClassBytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	// When resolving from src/com/example/pkgB/Worker.java, it MUST resolve to pkgB/Worker.class,
	// never mistakenly picking pkgA/Worker.class due to naive basename match
	got, name, err := ResolveClassFile(root, "src/com/example/pkgB/Worker.java", "")
	if err != nil {
		t.Fatalf("ResolveClassFile error: %v", err)
	}
	if got != classFileB {
		t.Fatalf("resolved class file = %q, want %q", got, classFileB)
	}
	if name != "com.example.pkgB.Worker" {
		t.Fatalf("resolved name = %q, want com.example.pkgB.Worker", name)
	}
}

func TestRedefineClassLive_HashMismatchRejection_T14(t *testing.T) {
	root := t.TempDir()
	pkg := filepath.Join(root, "com", "example")
	if err := os.MkdirAll(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	classFile := filepath.Join(pkg, "Service.class")
	if err := os.WriteFile(classFile, makeMinimalClassBytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	// Provide an expected hash that does NOT match the class file
	_, err := RedefineClassLive(LiveRedefineRequest{
		Port:         5005,
		ClassPath:    root,
		SourcePath:   "src/com/example/Service.java",
		ExpectedHash: "0000000000000000000000000000000000000000000000000000000000000000",
	}, nil)
	if err == nil {
		t.Fatal("expected error due to artifact hash mismatch, got nil")
	}
	if !strings.Contains(err.Error(), "artifact hash mismatch") {
		t.Fatalf("expected hash mismatch error, got: %v", err)
	}
}

type fakeJDWPClient struct {
	classes      []ClassRef
	classLoaders map[int64]int64
	redefined    []ClassRedefinition
	closed       bool
}

func (f *fakeJDWPClient) IDSizes() (JDWPIDSizes, error) {
	return JDWPIDSizes{FieldIDSize: 8, MethodIDSize: 8, ObjectIDSize: 8, ReferenceTypeIDSize: 8, FrameIDSize: 8}, nil
}

func (f *fakeJDWPClient) ClassesBySignature(sig string) ([]ClassRef, error) {
	return f.classes, nil
}

func (f *fakeJDWPClient) GetClassLoader(typeID int64) (int64, error) {
	return f.classLoaders[typeID], nil
}

func (f *fakeJDWPClient) RedefineClasses(classes []ClassRedefinition) error {
	f.redefined = append(f.redefined, classes...)
	return nil
}

func (f *fakeJDWPClient) Close() error {
	f.closed = true
	return nil
}

func TestRedefineClassWithClient_AmbiguousClassLoader_Rejects_T18(t *testing.T) {
	root := t.TempDir()
	pkg := filepath.Join(root, "com", "example")
	if err := os.MkdirAll(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	classFile := filepath.Join(pkg, "Dual.class")
	if err := os.WriteFile(classFile, makeMinimalClassBytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	// Class loaded by 2 distinct ClassLoaders in same JVM (e.g. 1001 and 1002)
	fake := &fakeJDWPClient{
		classes: []ClassRef{
			{RefTypeTag: 1, TypeID: 501, Status: 1},
			{RefTypeTag: 1, TypeID: 502, Status: 1},
		},
		classLoaders: map[int64]int64{
			501: 1001,
			502: 1002,
		},
	}

	// Calling without ClassLoaderID MUST be rejected with ambiguous_class_loader
	// Taking refs[0] blindly is strictly prohibited!
	_, err := RedefineClassWithClient(fake, LiveRedefineRequest{
		ClassPath:  root,
		SourcePath: "src/com/example/Dual.java",
	}, nil)

	if err == nil {
		t.Fatal("expected error for ambiguous class loaders, got nil")
	}
	if !strings.Contains(err.Error(), "ambiguous_class_loader") {
		t.Fatalf("expected ambiguous_class_loader error, got: %v", err)
	}
	if len(fake.redefined) != 0 {
		t.Fatalf("expected 0 classes redefined, got %d", len(fake.redefined))
	}
}

func TestRedefineClassWithClient_DisambiguateByClassLoaderID_T18(t *testing.T) {
	root := t.TempDir()
	pkg := filepath.Join(root, "com", "example")
	if err := os.MkdirAll(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	classFile := filepath.Join(pkg, "Dual.class")
	if err := os.WriteFile(classFile, makeMinimalClassBytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	fake := &fakeJDWPClient{
		classes: []ClassRef{
			{RefTypeTag: 1, TypeID: 501, Status: 1},
			{RefTypeTag: 1, TypeID: 502, Status: 1},
		},
		classLoaders: map[int64]int64{
			501: 1001,
			502: 1002,
		},
	}

	// Disambiguate with ClassLoaderID: 1002
	res, err := RedefineClassWithClient(fake, LiveRedefineRequest{
		ClassPath:     root,
		SourcePath:    "src/com/example/Dual.java",
		ClassLoaderID: "1002",
	}, nil)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.RefTypeID != 502 {
		t.Fatalf("expected RefTypeID 502, got %d", res.RefTypeID)
	}
	if len(fake.redefined) != 1 {
		t.Fatalf("expected 1 class redefined, got %d", len(fake.redefined))
	}
	if fake.redefined[0].RefTypeID != 502 {
		t.Fatalf("expected redefined RefTypeID 502, got %d", fake.redefined[0].RefTypeID)
	}
}

func TestRedefineClassWithClient_ClassLoaderMismatch_Rejects_T18(t *testing.T) {
	root := t.TempDir()
	pkg := filepath.Join(root, "com", "example")
	if err := os.MkdirAll(pkg, 0o755); err != nil {
		t.Fatal(err)
	}
	classFile := filepath.Join(pkg, "Single.class")
	if err := os.WriteFile(classFile, makeMinimalClassBytes(), 0o644); err != nil {
		t.Fatal(err)
	}

	fake := &fakeJDWPClient{
		classes: []ClassRef{
			{RefTypeTag: 1, TypeID: 501, Status: 1},
		},
		classLoaders: map[int64]int64{
			501: 1001,
		},
	}

	// ClassLoaderID 9999 does not match actual classloader 1001
	_, err := RedefineClassWithClient(fake, LiveRedefineRequest{
		ClassPath:     root,
		SourcePath:    "src/com/example/Single.java",
		ClassLoaderID: "9999",
	}, nil)

	if err == nil {
		t.Fatal("expected error for class loader mismatch, got nil")
	}
	if !strings.Contains(err.Error(), "class_loader_mismatch") {
		t.Fatalf("expected class_loader_mismatch error, got: %v", err)
	}
	if len(fake.redefined) != 0 {
		t.Fatalf("expected 0 classes redefined, got %d", len(fake.redefined))
	}
}


