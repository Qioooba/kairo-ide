package debug

import (
	"os"
	"path/filepath"
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
