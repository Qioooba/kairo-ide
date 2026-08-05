package debug

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LiveRedefineRequest carries inputs for a live JDWP RedefineClasses call.
type LiveRedefineRequest struct {
	Host       string
	Port       int
	ClassPath  string
	SourcePath string
	ClassName  string
	ClassBytes []byte
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
	var found string
	var foundRel string
	_ = filepath.Walk(absOut, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil || info == nil || info.IsDir() {
			return walkErr
		}
		if info.Name() == base+".class" {
			found = path
			rel, _ := filepath.Rel(absOut, path)
			foundRel = rel
			return filepath.SkipAll
		}
		return nil
	})
	if found == "" {
		return "", "", fmt.Errorf("no %s.class under %s", base, absOut)
	}
	bin := strings.TrimSuffix(foundRel, ".class")
	bin = strings.ReplaceAll(bin, string(filepath.Separator), ".")
	bin = strings.ReplaceAll(bin, "/", ".")
	bin = strings.ReplaceAll(bin, "\\", ".")
	return found, bin, nil
}

// RedefineClassLive dials JDWP, resolves the class reference, and issues RedefineClasses.
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
	validator := hsm
	if validator == nil {
		validator = NewHotSwapManager()
	}
	if err := validator.validateClassBytes(classBytes); err != nil {
		return nil, fmt.Errorf("invalid class bytes: %w", err)
	}

	conn, err := DialJDWP(req.Host, req.Port, 5*time.Second)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	sig := JNISignatureFromBinaryName(binaryName)
	refs, err := conn.ClassesBySignature(sig)
	if err != nil {
		return nil, fmt.Errorf("ClassesBySignature(%s): %w", sig, err)
	}
	if len(refs) == 0 {
		return nil, fmt.Errorf("class %s is not loaded in the target JVM", binaryName)
	}
	redef := NewClassRedefinition(refs[0].TypeID, classBytes)
	if err := conn.RedefineClasses([]ClassRedefinition{*redef}); err != nil {
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
		RefTypeID: refs[0].TypeID,
		ByteCount: len(classBytes),
		JDWPHost:  host,
		JDWPPort:  req.Port,
	}, nil
}
