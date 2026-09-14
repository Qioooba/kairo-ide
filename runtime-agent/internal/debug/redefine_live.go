package debug

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/build"
)

// LiveRedefineRequest carries inputs for a live JDWP RedefineClasses call.
type LiveRedefineRequest struct {
	Host         string
	Port         int
	ClassPath    string
	SourcePath   string
	ClassName    string
	ClassBytes    []byte
	ExpectedHash  string
	ClassLoaderID string
	Manifest      *build.BuildArtifactManifest
}

// LiveRedefineResult is returned after a successful redefine.
type LiveRedefineResult struct {
	ClassName string
	RefTypeID int64
	ByteCount int
	JDWPHost  string
	JDWPPort  int
}

// ResolveClassFile finds the .class file for a Java source under classPath.
// PR04 / F05: Strictly distinguishes packages instead of taking the first basename match.
func ResolveClassFile(classPath, sourcePath, className string) (classFile string, binaryName string, err error) {
	if classPath == "" {
		return "", "", fmt.Errorf("classPath required")
	}
	absOut, err := filepath.Abs(classPath)
	if err != nil {
		return "", "", err
	}
	if className != "" {
		rel := strings.ReplaceAll(className, ".", string(filepath.Separator)) + ".class"
		candidate := filepath.Join(absOut, rel)
		if st, e := os.Stat(candidate); e == nil && !st.IsDir() {
			return candidate, className, nil
		}
		return "", "", fmt.Errorf("class file not found for %s under %s", className, absOut)
	}
	base := strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
	if base == "" || base == "." {
		return "", "", fmt.Errorf("cannot derive class name from sourcePath %q", sourcePath)
	}

	normSource := filepath.ToSlash(filepath.Clean(sourcePath))
	var candidates []struct {
		path       string
		binaryName string
	}

	_ = filepath.Walk(absOut, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil || info == nil || info.IsDir() {
			return walkErr
		}
		if info.Name() != base+".class" {
			return nil
		}
		rel, _ := filepath.Rel(absOut, path)
		relSlash := filepath.ToSlash(rel)
		bin := strings.TrimSuffix(relSlash, ".class")
		bin = strings.ReplaceAll(bin, "/", ".")

		// Try bytecode parse for authoritative name if available
		if data, rErr := os.ReadFile(path); rErr == nil {
			if cInfo, pErr := build.ParseClassFile(data); pErr == nil && cInfo.BinaryName != "" && !strings.Contains(cInfo.BinaryName, "java.lang") {
				bin = cInfo.BinaryName
			}
		}

		// Verify package path alignment with sourcePath
		expectedRelSource := strings.ReplaceAll(bin, ".", "/") + ".java"
		if strings.HasSuffix(normSource, expectedRelSource) {
			candidates = append([]struct {
				path       string
				binaryName string
			}{{path: path, binaryName: bin}}, candidates...) // prioritize exact package match
		} else {
			candidates = append(candidates, struct {
				path       string
				binaryName string
			}{path: path, binaryName: bin})
		}
		return nil
	})

	if len(candidates) == 0 {
		return "", "", fmt.Errorf("no %s.class under %s", base, absOut)
	}

	// Check for ambiguity across different packages
	firstPkg := candidates[0].binaryName
	if idx := strings.LastIndex(firstPkg, "."); idx >= 0 {
		firstPkg = firstPkg[:idx]
	}
	for i := 1; i < len(candidates); i++ {
		pkg := candidates[i].binaryName
		if idx := strings.LastIndex(pkg, "."); idx >= 0 {
			pkg = pkg[:idx]
		}
		if pkg != firstPkg && !strings.HasSuffix(normSource, strings.ReplaceAll(candidates[0].binaryName, ".", "/") + ".java") {
			return "", "", fmt.Errorf("ambiguous class resolution for %s: found multiple packages (%s vs %s)",
				sourcePath, firstPkg, pkg)
		}
	}

	return candidates[0].path, candidates[0].binaryName, nil
}

// ResolveArtifacts returns all artifacts for a source file using manifest when available,
// verifying file integrity on disk (PR04 / F05 / T12-T14).
func ResolveArtifacts(manifest *build.BuildArtifactManifest, classPath, sourcePath, className string) ([]build.ArtifactItem, error) {
	if manifest != nil && sourcePath != "" {
		items := manifest.FindArtifactsForSource(sourcePath)
		if len(items) > 0 {
			for _, item := range items {
				if err := manifest.VerifyArtifactOnDisk(item); err != nil {
					return nil, err
				}
			}
			return items, nil
		}
	}

	classFile, name, err := ResolveClassFile(classPath, sourcePath, className)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(classFile)
	if err != nil {
		return nil, fmt.Errorf("read class file %s: %w", classFile, err)
	}
	sum := sha256.Sum256(data)
	hashStr := hex.EncodeToString(sum[:])

	return []build.ArtifactItem{{
		BinaryName:   name,
		SourcePath:   sourcePath,
		ArtifactPath: classFile,
		SHA256:       hashStr,
	}}, nil
}

// RedefineClassLive validates artifacts and hash integrity before dialing JDWP and issuing RedefineClasses.
func RedefineClassLive(req LiveRedefineRequest, hsm *HotSwapManager) (*LiveRedefineResult, error) {
	if req.Port <= 0 {
		return nil, fmt.Errorf("jdwpPort required")
	}

	classBytes := req.ClassBytes
	binaryName := req.ClassName
	if len(classBytes) == 0 {
		classFile, name, err := ResolveClassFile(req.ClassPath, req.SourcePath, req.ClassName)
		if err != nil {
			return nil, err
		}
		binaryName = name
		classBytes, err = os.ReadFile(classFile)
		if err != nil {
			return nil, fmt.Errorf("read class bytes: %w", err)
		}
	}
	if binaryName == "" {
		return nil, fmt.Errorf("className required when ClassBytes provided without name")
	}

	// PR04 (F05 / T14): Verify hash integrity if expected hash or manifest provided
	if req.Manifest != nil && req.SourcePath != "" {
		artifacts := req.Manifest.FindArtifactsForSource(req.SourcePath)
		for _, art := range artifacts {
			if err := req.Manifest.VerifyArtifactOnDisk(art); err != nil {
				return nil, err
			}
		}
	}
	if req.ExpectedHash != "" && len(classBytes) > 0 {
		sum := sha256.Sum256(classBytes)
		actualHash := hex.EncodeToString(sum[:])
		if actualHash != req.ExpectedHash {
			return nil, fmt.Errorf("artifact hash mismatch: expected %s, got %s (file was modified on disk)", req.ExpectedHash, actualHash)
		}
	}

	validator := hsm
	if validator == nil {
		validator = NewHotSwapManager()
	}
	if err := validator.validateClassBytes(classBytes); err != nil {
		return nil, fmt.Errorf("invalid class bytes: %w", err)
	}

	req.ClassBytes = classBytes
	req.ClassName = binaryName

	conn, err := DialJDWP(req.Host, req.Port, 5*time.Second)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	return RedefineClassWithClient(conn, req, hsm)
}

// RedefineClassWithClient performs class resolution, ClassLoader disambiguation, and redefinition using a JDWPClient (PR05 / F06 / T18).
func RedefineClassWithClient(client JDWPClient, req LiveRedefineRequest, hsm *HotSwapManager) (*LiveRedefineResult, error) {
	classBytes := req.ClassBytes
	binaryName := req.ClassName
	if len(classBytes) == 0 {
		classFile, name, err := ResolveClassFile(req.ClassPath, req.SourcePath, req.ClassName)
		if err != nil {
			return nil, err
		}
		binaryName = name
		classBytes, err = os.ReadFile(classFile)
		if err != nil {
			return nil, fmt.Errorf("read class bytes: %w", err)
		}
	}
	if binaryName == "" {
		return nil, fmt.Errorf("className required when ClassBytes provided without name")
	}

	// PR04 (F05 / T14): Verify hash integrity if expected hash or manifest provided
	if req.Manifest != nil && req.SourcePath != "" {
		artifacts := req.Manifest.FindArtifactsForSource(req.SourcePath)
		for _, art := range artifacts {
			if err := req.Manifest.VerifyArtifactOnDisk(art); err != nil {
				return nil, err
			}
		}
	}
	if req.ExpectedHash != "" && len(classBytes) > 0 {
		sum := sha256.Sum256(classBytes)
		actualHash := hex.EncodeToString(sum[:])
		if actualHash != req.ExpectedHash {
			return nil, fmt.Errorf("artifact hash mismatch: expected %s, got %s (file was modified on disk)", req.ExpectedHash, actualHash)
		}
	}

	validator := hsm
	if validator == nil {
		validator = NewHotSwapManager()
	}
	if err := validator.validateClassBytes(classBytes); err != nil {
		return nil, fmt.Errorf("invalid class bytes: %w", err)
	}

	sig := JNISignatureFromBinaryName(binaryName)
	refs, err := client.ClassesBySignature(sig)
	if err != nil {
		return nil, fmt.Errorf("ClassesBySignature(%s): %w", sig, err)
	}
	if len(refs) == 0 {
		return nil, fmt.Errorf("class %s is not loaded in the target JVM", binaryName)
	}

	var targetRef *ClassRef
	if len(refs) == 1 {
		if req.ClassLoaderID != "" {
			loaderID, lErr := client.GetClassLoader(refs[0].TypeID)
			if lErr != nil {
				return nil, fmt.Errorf("resolve class loader for %s: %w", binaryName, lErr)
			}
			loaderStr := fmt.Sprintf("%d", loaderID)
			if loaderStr != req.ClassLoaderID {
				return nil, fmt.Errorf("class_loader_mismatch: class %s is loaded by loader %s, but target bound to %s", binaryName, loaderStr, req.ClassLoaderID)
			}
		}
		targetRef = &refs[0]
	} else {
		// len(refs) > 1: PR05 (F06 / T18) Multiple ClassLoaders in same JVM
		// Blindly taking refs[0] is strictly prohibited.
		if req.ClassLoaderID == "" {
			return nil, fmt.Errorf("ambiguous_class_loader: class %s is loaded by %d class loaders in the target JVM; classLoaderId binding is required to disambiguate", binaryName, len(refs))
		}
		var matched []ClassRef
		for _, ref := range refs {
			loaderID, lErr := client.GetClassLoader(ref.TypeID)
			if lErr != nil {
				continue
			}
			if fmt.Sprintf("%d", loaderID) == req.ClassLoaderID {
				matched = append(matched, ref)
			}
		}
		if len(matched) == 0 {
			return nil, fmt.Errorf("class_loader_not_found: class %s has no instance loaded by classLoaderId %s", binaryName, req.ClassLoaderID)
		}
		if len(matched) > 1 {
			return nil, fmt.Errorf("ambiguous_class_loader: class %s matched multiple type IDs under classLoaderId %s", binaryName, req.ClassLoaderID)
		}
		targetRef = &matched[0]
	}

	redef := NewClassRedefinition(targetRef.TypeID, classBytes)
	if err := client.RedefineClasses([]ClassRedefinition{*redef}); err != nil {
		return nil, fmt.Errorf("RedefineClasses: %w", err)
	}
	if hsm != nil {
		hsm.SetCapabilities(&DebugCapabilities{CanRedefineClasses: true})
		_ = hsm.RedefineClass(binaryName, classBytes, nil)
	}
	host := req.Host
	if host == "" {
		host = "127.0.0.1"
	}
	return &LiveRedefineResult{
		ClassName: binaryName,
		RefTypeID: targetRef.TypeID,
		ByteCount: len(classBytes),
		JDWPHost:  host,
		JDWPPort:  req.Port,
	}, nil
}
