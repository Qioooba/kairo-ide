package pathpolicy

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestValidateRelativeConfigPath(t *testing.T) {
	p := NewDefaultPathPolicy()

	validPaths := []string{
		".",
		"src",
		"src/main/java",
		"WebRoot",
		"build/classes",
		"项目目录/src",
		"path with spaces",
	}

	for _, path := range validPaths {
		t.Run("valid_"+path, func(t *testing.T) {
			if err := p.ValidateRelativeConfigPath(path, false); err != nil {
				t.Errorf("expected valid path %q, got error: %v", path, err)
			}
		})
	}

	invalidPaths := []struct {
		path string
		err  error
	}{
		{"", ErrEmptyPath},
		{"/absolute", ErrAbsolutePath},
		{"../outside", ErrPathTraversal},
		{"foo/../bar", ErrPathTraversal},
		{"./foo/../../baz", ErrPathTraversal},
		{`C:\outside`, ErrVolumeName},
		{`C:/outside`, ErrVolumeName},
		{"c:/outside", ErrVolumeName},
		{`D:\test`, ErrVolumeName},
		{`\\server\share`, ErrVolumeName},
		{"//server/share", ErrVolumeName},
		{`foo\bar`, ErrBackslash},
		{`src\main\java`, ErrBackslash},
	}

	for _, tc := range invalidPaths {
		t.Run("invalid_"+tc.path, func(t *testing.T) {
			err := p.ValidateRelativeConfigPath(tc.path, false)
			if err == nil {
				t.Errorf("expected error for path %q", tc.path)
			}
		})
	}

	t.Run("empty_allowed", func(t *testing.T) {
		if err := p.ValidateRelativeConfigPath("", true); err != nil {
			t.Errorf("expected empty path allowed, got: %v", err)
		}
	})
}

func TestResolveWithin(t *testing.T) {
	p := NewDefaultPathPolicy()
	tmpDir := t.TempDir()
	tmpDir, err := filepath.EvalSymlinks(tmpDir)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("valid_resolution", func(t *testing.T) {
		resolved, err := p.ResolveWithin(tmpDir, "src/main/java")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := filepath.Join(tmpDir, "src", "main", "java")
		if resolved != expected {
			t.Errorf("expected %s, got %s", expected, resolved)
		}
	})

	t.Run("traversal_rejected", func(t *testing.T) {
		_, err := p.ResolveWithin(tmpDir, "../outside")
		if err == nil {
			t.Error("expected error for path traversal")
		}
	})

	t.Run("dot_resolves_to_root", func(t *testing.T) {
		resolved, err := p.ResolveWithin(tmpDir, ".")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resolved != tmpDir {
			t.Errorf("expected %s, got %s", tmpDir, resolved)
		}
	})

	t.Run("windows_volume_rejected_on_all_platforms", func(t *testing.T) {
		_, err := p.ResolveWithin(tmpDir, "C:/outside")
		if err == nil {
			t.Error("expected error for Windows volume path")
		}
		_, err = p.ResolveWithin(tmpDir, `D:\test`)
		if err == nil {
			t.Error("expected error for Windows volume path with backslash")
		}
	})

	t.Run("unc_path_rejected_on_all_platforms", func(t *testing.T) {
		_, err := p.ResolveWithin(tmpDir, "//server/share")
		if err == nil {
			t.Error("expected error for UNC path")
		}
		_, err = p.ResolveWithin(tmpDir, `\\server\share`)
		if err == nil {
			t.Error("expected error for UNC path with backslash")
		}
	})

	t.Run("backslash_rejected", func(t *testing.T) {
		_, err := p.ResolveWithin(tmpDir, `foo\bar`)
		if err == nil {
			t.Error("expected error for backslash path")
		}
	})
}

func TestResolveWithinSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink tests require Unix")
	}

	p := NewDefaultPathPolicy()
	tmpDir := t.TempDir()

	outsideDir := filepath.Join(tmpDir, "outside")
	if err := os.MkdirAll(outsideDir, 0755); err != nil {
		t.Fatal(err)
	}

	projectDir := filepath.Join(tmpDir, "project")
	if err := os.MkdirAll(projectDir, 0755); err != nil {
		t.Fatal(err)
	}

	symlinkPath := filepath.Join(projectDir, "link")
	if err := os.Symlink(outsideDir, symlinkPath); err != nil {
		t.Fatal(err)
	}

	t.Run("symlink_escape_detected", func(t *testing.T) {
		_, err := p.ResolveWithin(projectDir, "link")
		if err == nil {
			t.Error("expected error for symlink escape")
		}
	})

	t.Run("symlink_escape_multilevel_nonexistent", func(t *testing.T) {
		_, err := p.ResolveWithin(projectDir, "link/nonexistent/deeper/file.txt")
		if err == nil {
			t.Error("expected error for symlink escape through nonexistent multilevel path")
		}
	})

	t.Run("symlink_escape_nonexistent_parent", func(t *testing.T) {
		nonexistentLink := filepath.Join(projectDir, "nonexistent_link")
		os.Symlink(outsideDir, nonexistentLink)
		_, err := p.ResolveWithin(projectDir, "nonexistent_link")
		if err == nil {
			t.Error("expected error for symlink escape (nonexistent target but symlink exists)")
		}
	})

	t.Run("nofollow_allows_lexical", func(t *testing.T) {
		resolved, err := p.ResolveWithinNoFollow(projectDir, "link/file.txt")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := filepath.Join(projectDir, "link", "file.txt")
		if resolved != expected {
			t.Errorf("expected %s, got %s", expected, resolved)
		}
	})
}

func TestResolveWithinRootSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink tests require Unix")
	}

	p := NewDefaultPathPolicy()
	tmpDir := t.TempDir()

	realRoot := filepath.Join(tmpDir, "realroot")
	if err := os.MkdirAll(realRoot, 0755); err != nil {
		t.Fatal(err)
	}

	linkToRoot := filepath.Join(tmpDir, "linkroot")
	if err := os.Symlink(realRoot, linkToRoot); err != nil {
		t.Fatal(err)
	}

	t.Run("root_itself_is_symlink_resolves_correctly", func(t *testing.T) {
		if err := os.WriteFile(filepath.Join(realRoot, "file.txt"), []byte("test"), 0644); err != nil {
			t.Fatal(err)
		}
		resolved, err := p.ResolveWithin(linkToRoot, "file.txt")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected, err := filepath.EvalSymlinks(filepath.Join(realRoot, "file.txt"))
		if err != nil {
			t.Fatal(err)
		}
		if resolved != expected {
			t.Errorf("expected %s, got %s", expected, resolved)
		}
	})

	t.Run("root_symlink_with_internal_symlink_escape_detected", func(t *testing.T) {
		outsideDir := filepath.Join(tmpDir, "outside")
		if err := os.MkdirAll(outsideDir, 0o755); err != nil {
			t.Fatal(err)
		}
		internalLink := filepath.Join(realRoot, "link")
		if err := os.Symlink(outsideDir, internalLink); err != nil {
			t.Fatal(err)
		}
		_, err := p.ResolveWithin(linkToRoot, "link/file.txt")
		if err == nil {
			t.Error("expected error when symlink inside root escapes")
		}
	})
}

func TestValidateDeployTarget(t *testing.T) {
	validTargets := []string{
		"index.html",
		"WEB-INF/classes/Foo.class",
		"WEB-INF/lib/bar.jar",
		"css/style.css",
	}

	for _, target := range validTargets {
		t.Run("valid_"+target, func(t *testing.T) {
			if err := ValidateDeployTarget(target); err != nil {
				t.Errorf("expected valid target %q, got: %v", target, err)
			}
		})
	}

	invalidTargets := []string{
		"",
		"/etc/passwd",
		"../outside",
		"WEB-INF/../../outside",
		"C:/Windows/System32",
		`C:\Windows\System32`,
		"//server/share",
		`\\server\share`,
		`foo\bar`,
	}

	for _, target := range invalidTargets {
		t.Run("invalid_"+target, func(t *testing.T) {
			if err := ValidateDeployTarget(target); err == nil {
				t.Errorf("expected error for target %q", target)
			}
		})
	}
}
