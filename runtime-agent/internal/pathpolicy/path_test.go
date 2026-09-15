package pathpolicy

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

func TestResolveWithinNoFollow(t *testing.T) {
	p := NewDefaultPathPolicy()
	tmpDir := t.TempDir()
	tmpDir, err := filepath.EvalSymlinks(tmpDir)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("valid_resolution", func(t *testing.T) {
		resolved, err := p.ResolveWithinNoFollow(tmpDir, "src/main/java")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		expected := filepath.Join(tmpDir, "src", "main", "java")
		if resolved != expected {
			t.Errorf("expected %s, got %s", expected, resolved)
		}
	})

	t.Run("traversal_rejected", func(t *testing.T) {
		_, err := p.ResolveWithinNoFollow(tmpDir, "../outside")
		if err == nil {
			t.Error("expected error for path traversal")
		}
	})

	t.Run("dot_resolves_to_root", func(t *testing.T) {
		resolved, err := p.ResolveWithinNoFollow(tmpDir, ".")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resolved != tmpDir {
			t.Errorf("expected %s, got %s", tmpDir, resolved)
		}
	})

	t.Run("empty_path_rejected", func(t *testing.T) {
		_, err := p.ResolveWithinNoFollow(tmpDir, "")
		if err == nil {
			t.Error("expected error for empty path")
		}
	})
}

func TestAtomicRename(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.txt")
	dst := filepath.Join(dir, "dst.txt")

	if err := os.WriteFile(src, []byte("rename"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := AtomicRename(src, dst); err != nil {
		t.Fatalf("AtomicRename failed: %v", err)
	}

	data, err := os.ReadFile(dst)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "rename" {
		t.Errorf("got %q, want %q", string(data), "rename")
	}
}

func TestAtomicRename_Error(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "nonexistent.txt")
	dst := filepath.Join(dir, "dst.txt")
	if err := AtomicRename(src, dst); err == nil {
		t.Fatal("expected error for nonexistent source")
	}
}

func TestCanonicalizeAbs_EmptyPath(t *testing.T) {
	_, err := canonicalizeAbs("")
	if err == nil {
		t.Fatal("expected error for empty path")
	}
}

func TestIsLexicallyUnder_EdgeCases(t *testing.T) {
	dir := t.TempDir()

	t.Run("same_path", func(t *testing.T) {
		if !isLexicallyUnder(dir, dir) {
			t.Error("expected same path to be under itself")
		}
	})

	t.Run("direct_child", func(t *testing.T) {
		child := filepath.Join(dir, "child")
		if !isLexicallyUnder(child, dir) {
			t.Error("expected child to be under parent")
		}
	})

	t.Run("not_under", func(t *testing.T) {
		other := t.TempDir()
		if isLexicallyUnder(other, dir) {
			t.Error("expected other dir not to be under parent")
		}
	})

	t.Run("dot_relative", func(t *testing.T) {
		if !isLexicallyUnder(dir, dir) {
			t.Error("expected dot relative to be under")
		}
	})
}

func TestValidateDeployTarget_DotSegments(t *testing.T) {
	// Single dot should be valid
	if err := ValidateDeployTarget("."); err != nil {
		t.Errorf("expected valid target '.', got: %v", err)
	}

	// Dot in middle should be invalid
	if err := ValidateDeployTarget("foo/./bar"); err == nil {
		t.Error("expected error for dot segment in middle")
	}

	// Trailing dot
	if err := ValidateDeployTarget("foo/."); err == nil {
		t.Error("expected error for trailing dot segment")
	}
}

func TestValidateRelativeConfigPath_NULCharacter(t *testing.T) {
	p := NewDefaultPathPolicy()

	err := p.ValidateRelativeConfigPath("foo\x00bar", false)
	if err == nil {
		t.Fatal("expected error for NUL character")
	}
	if err != ErrNULCharacter {
		t.Errorf("expected ErrNULCharacter, got: %v", err)
	}
}

func TestValidateRelativeConfigPath_OnlyDot(t *testing.T) {
	p := NewDefaultPathPolicy()
	// "." is a valid relative path
	if err := p.ValidateRelativeConfigPath(".", false); err != nil {
		t.Errorf("expected valid path '.', got: %v", err)
	}
}

func TestIsLexicallyUnder_NotUnder(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Volume-rooted paths behave differently on Windows")
	}
	// Two completely different absolute paths
	if isLexicallyUnder("/tmp/foo", "/tmp/bar") {
		t.Error("expected /tmp/foo not to be under /tmp/bar")
	}
}

func TestIsLexicallyUnder_ParentDir(t *testing.T) {
	// Child's parent should not be under child
	if isLexicallyUnder("/tmp", "/tmp/foo") {
		t.Error("expected parent not to be under child")
	}
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

func TestResolveURIOrPath(t *testing.T) {
	t.Run("empty_and_nul", func(t *testing.T) {
		if _, err := ResolveURIOrPath(""); !errors.Is(err, ErrEmptyPath) {
			t.Errorf("expected ErrEmptyPath, got %v", err)
		}
		if _, err := ResolveURIOrPath("foo\x00bar"); !errors.Is(err, ErrNULCharacter) {
			t.Errorf("expected ErrNULCharacter, got %v", err)
		}
	})

	t.Run("unsupported_scheme", func(t *testing.T) {
		for _, raw := range []string{"http://example.com/foo.java", "git://github.com/repo.git", "ftp://files/a.txt"} {
			if _, err := ResolveURIOrPath(raw); err == nil {
				t.Errorf("expected error for non-file URI %q, got nil", raw)
			}
		}
	})

	t.Run("percent_encoding_and_spaces", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			res, err := ResolveURIOrPath("file:///C:/My%20Project/src/A.java")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			expected := `C:\My Project\src\A.java`
			if !strings.EqualFold(res, expected) {
				t.Errorf("got %q, want %q", res, expected)
			}

			// Chinese characters %E4%B8%AD%E6%96%87
			resZh, err := ResolveURIOrPath("file:///C:/repo/%E4%B8%AD%E6%96%87/Main.java")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			expectedZh := `C:\repo\中文\Main.java`
			if !strings.EqualFold(resZh, expectedZh) {
				t.Errorf("got %q, want %q", resZh, expectedZh)
			}

			// UNC path: remote host must be rejected to prevent SMB SSRF (P0-2)
			_, errUNC := ResolveURIOrPath("file://myserver/myshare/dir/App.java")
			if errUNC == nil {
				t.Fatalf("expected error for remote UNC path, got nil")
			}
			if !strings.Contains(errUNC.Error(), "remote host in file URI not allowed") {
				t.Errorf("expected 'remote host in file URI not allowed' error, got %v", errUNC)
			}
		} else {
			res, err := ResolveURIOrPath("file:///tmp/My%20Project/src/A.java")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			expected := "/tmp/My Project/src/A.java"
			if res != expected {
				t.Errorf("got %q, want %q", res, expected)
			}
		}
	})

	t.Run("plain_native_path", func(t *testing.T) {
		tmpDir := t.TempDir()
		file := filepath.Join(tmpDir, "A.java")
		res, err := ResolveURIOrPath(file)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res != filepath.Clean(file) {
			t.Errorf("got %q, want %q", res, filepath.Clean(file))
		}
	})
}

func TestIsLexicallyUnder_SiblingCollision(t *testing.T) {
	if runtime.GOOS == "windows" {
		parent := `C:\work\my-repo`
		sibling := `C:\work\my-repo-other\Foo.java`
		child := `C:\work\my-repo\src\Foo.java`

		if IsLexicallyUnder(sibling, parent) {
			t.Errorf("sibling %q must NOT be under %q", sibling, parent)
		}
		if !IsLexicallyUnder(child, parent) {
			t.Errorf("child %q must be under %q", child, parent)
		}
	} else {
		parent := "/work/my-repo"
		sibling := "/work/my-repo-other/Foo.java"
		child := "/work/my-repo/src/Foo.java"

		if IsLexicallyUnder(sibling, parent) {
			t.Errorf("sibling %q must NOT be under %q", sibling, parent)
		}
		if !IsLexicallyUnder(child, parent) {
			t.Errorf("child %q must be under %q", child, parent)
		}
	}
}

func TestIsLexicallyUnder_ValidDoubleDotFile(t *testing.T) {
	parent := filepath.Join(t.TempDir(), "project")
	validFile := filepath.Join(parent, "..foo")
	if !IsLexicallyUnder(validFile, parent) {
		t.Errorf("valid file named %q should be lexically under parent %q", validFile, parent)
	}

	outsideFile := filepath.Join(parent, "..", "foo")
	if IsLexicallyUnder(outsideFile, parent) {
		t.Errorf("outside file %q should NOT be lexically under parent %q", outsideFile, parent)
	}
}

func TestResolveURIOrPath_FragmentAndWindowsDriveDoubleSlash(t *testing.T) {
	// Fragment stripping
	uriWithFrag := "file:///c:/project/Test.java#L42"
	res, err := ResolveURIOrPath(uriWithFrag)
	if err != nil {
		t.Fatalf("unexpected error resolving URI with fragment: %v", err)
	}
	if strings.Contains(res, "#") {
		t.Errorf("fragment was not stripped from resolved path: %q", res)
	}

	// Windows C:// double slash
	if runtime.GOOS == "windows" {
		winDoubleSlash := "C://project//src//Test.java"
		resWin, err := ResolveURIOrPath(winDoubleSlash)
		if err != nil {
			t.Fatalf("unexpected error resolving C://: %v", err)
		}
		if !strings.HasPrefix(strings.ToLower(resWin), "c:\\") {
			t.Errorf("expected resolved Windows path starting with C:\\, got %q", resWin)
		}
	}
}

func TestResolveURIOrPath_RejectsRemoteHost(t *testing.T) {
	maliciousURIs := []string{
		"file://evil-host.com/share/payload.war",
		"file://192.168.1.100/share/test",
		"file://attacker/c$/windows/system32",
	}

	for _, uri := range maliciousURIs {
		_, err := ResolveURIOrPath(uri)
		if err == nil {
			t.Errorf("expected error for remote file URI %q, got nil", uri)
		} else if !strings.Contains(err.Error(), "remote host in file URI not allowed") {
			t.Errorf("expected 'remote host in file URI not allowed' error, got %v", err)
		}
	}

	// Localhost and empty host must still be accepted
	validURIs := []string{
		"file:///project/src/Main.java",
		"file://localhost/project/src/Main.java",
	}
	for _, uri := range validURIs {
		res, err := ResolveURIOrPath(uri)
		if err != nil {
			t.Errorf("expected localhost/empty-host URI %q to succeed, got %v", uri, err)
		}
		if res == "" {
			t.Errorf("expected non-empty resolved path for %q", uri)
		}
	}
}

