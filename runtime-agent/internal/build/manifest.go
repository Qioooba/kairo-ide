package build

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ToolchainInfo describes the toolchain used to produce artifacts.
type ToolchainInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	Kind    string `json:"kind"`
}

// ArtifactItem represents a single compiled .class artifact (PR04 / F05).
type ArtifactItem struct {
	BinaryName   string `json:"binaryName"`
	SourceURI    string `json:"sourceUri"`
	SourcePath   string `json:"sourcePath"`
	ArtifactURI  string `json:"artifactUri"`
	ArtifactPath string `json:"artifactPath"`
	SHA256       string `json:"sha256"`
	MajorVersion int    `json:"majorVersion"`
}

// BuildArtifactManifest tracks exact mapping from source files to binary names,
// class file paths, sha256 digests, and removed artifacts across builds (PR04 / F05).
type BuildArtifactManifest struct {
	BuildID          string         `json:"buildId"`
	ProjectID        string         `json:"projectId"`
	Toolchain        ToolchainInfo  `json:"toolchain"`
	CompletedAt      time.Time      `json:"completedAt"`
	Artifacts        []ArtifactItem `json:"artifacts"`
	RemovedArtifacts []string       `json:"removedArtifacts,omitempty"`
	SkippedArtifacts []string       `json:"skippedArtifacts,omitempty"`
}

// FindArtifactsForSource returns all class artifacts generated from the given source file.
// Matches top-level class as well as inner and anonymous classes ($1, $Inner).
func (m *BuildArtifactManifest) FindArtifactsForSource(sourcePath string) []ArtifactItem {
	if m == nil {
		return nil
	}
	normSource := filepath.Clean(sourcePath)
	var matched []ArtifactItem

	for _, art := range m.Artifacts {
		if art.SourcePath != "" {
			if filepath.Clean(art.SourcePath) == normSource {
				matched = append(matched, art)
			}
			continue
		}
		// If SourcePath not recorded, match by relative package path
		topLevelBinary := art.BinaryName
		if idx := strings.Index(topLevelBinary, "$"); idx >= 0 {
			topLevelBinary = topLevelBinary[:idx]
		}
		expectedRel := filepath.FromSlash(strings.ReplaceAll(topLevelBinary, ".", "/") + ".java")
		if strings.HasSuffix(normSource, expectedRel) {
			matched = append(matched, art)
		}
	}
	return matched
}

// FindArtifactByBinaryName looks up an artifact by its exact binary name.
func (m *BuildArtifactManifest) FindArtifactByBinaryName(binaryName string) *ArtifactItem {
	if m == nil {
		return nil
	}
	for i := range m.Artifacts {
		if m.Artifacts[i].BinaryName == binaryName {
			return &m.Artifacts[i]
		}
	}
	return nil
}

// VerifyArtifactOnDisk checks whether the class file exists on disk and matches its manifest SHA-256 (T14).
func (m *BuildArtifactManifest) VerifyArtifactOnDisk(item ArtifactItem) error {
	data, err := os.ReadFile(item.ArtifactPath)
	if err != nil {
		return fmt.Errorf("read artifact on disk %s: %w", item.ArtifactPath, err)
	}
	sum := sha256.Sum256(data)
	actualHash := hex.EncodeToString(sum[:])
	if actualHash != item.SHA256 {
		return fmt.Errorf("artifact hash mismatch for %s: expected %s, got %s (file was modified on disk)",
			item.BinaryName, item.SHA256, actualHash)
	}
	return nil
}

// ClassInfo holds metadata extracted from .class bytecode.
type ClassInfo struct {
	MajorVersion int
	MinorVersion int
	BinaryName   string
	SuperName    string
}

// ParseClassFile extracts ClassInfo from raw .class bytecode bytes.
func ParseClassFile(data []byte) (*ClassInfo, error) {
	if len(data) < 10 {
		return nil, errors.New("truncated class file")
	}
	if binary.BigEndian.Uint32(data[0:4]) != 0xCAFEBABE {
		return nil, errors.New("invalid magic number")
	}
	minor := int(binary.BigEndian.Uint16(data[4:6]))
	major := int(binary.BigEndian.Uint16(data[6:8]))
	cpCount := int(binary.BigEndian.Uint16(data[8:10]))

	offset := 10
	utf8s := make(map[int]string)
	classRefs := make(map[int]int)

	for i := 1; i < cpCount; i++ {
		if offset >= len(data) {
			return nil, errors.New("malformed constant pool: unexpected EOF")
		}
		tag := data[offset]
		offset++
		switch tag {
		case 1: // Utf8
			if offset+2 > len(data) {
				return nil, errors.New("malformed utf8 length")
			}
			uLen := int(binary.BigEndian.Uint16(data[offset : offset+2]))
			offset += 2
			if offset+uLen > len(data) {
				return nil, errors.New("malformed utf8 bytes")
			}
			utf8s[i] = string(data[offset : offset+uLen])
			offset += uLen
		case 3, 4: // Integer, Float
			offset += 4
		case 5, 6: // Long, Double (takes two CP entries)
			offset += 8
			i++
		case 7: // Class
			if offset+2 > len(data) {
				return nil, errors.New("malformed class ref")
			}
			classRefs[i] = int(binary.BigEndian.Uint16(data[offset : offset+2]))
			offset += 2
		case 8: // String
			offset += 2
		case 9, 10, 11: // Fieldref, Methodref, InterfaceMethodref
			offset += 4
		case 12: // NameAndType
			offset += 4
		case 15: // MethodHandle
			offset += 3
		case 16: // MethodType
			offset += 2
		case 17, 18: // Dynamic, InvokeDynamic
			offset += 4
		case 19, 20: // Module, Package
			offset += 2
		default:
			return nil, fmt.Errorf("unknown constant pool tag: %d", tag)
		}
	}

	if offset+6 > len(data) {
		return nil, errors.New("class file truncated before class headers")
	}
	offset += 2 // skip access_flags
	thisClassIdx := int(binary.BigEndian.Uint16(data[offset : offset+2]))
	offset += 2
	superClassIdx := int(binary.BigEndian.Uint16(data[offset : offset+2]))

	binaryName := ""
	if nameIdx, ok := classRefs[thisClassIdx]; ok {
		if rawName, ok := utf8s[nameIdx]; ok {
			binaryName = strings.ReplaceAll(rawName, "/", ".")
		}
	}
	superName := ""
	if nameIdx, ok := classRefs[superClassIdx]; ok {
		if rawName, ok := utf8s[nameIdx]; ok {
			superName = strings.ReplaceAll(rawName, "/", ".")
		}
	}

	return &ClassInfo{
		MajorVersion: major,
		MinorVersion: minor,
		BinaryName:   binaryName,
		SuperName:    superName,
	}, nil
}

func pathToURI(p string) string {
	if p == "" {
		return ""
	}
	clean := filepath.Clean(p)
	slashPath := filepath.ToSlash(clean)
	if len(slashPath) >= 2 && slashPath[1] == ':' {
		drive := strings.ToLower(string(slashPath[0]))
		slashPath = "/" + drive + slashPath[1:]
	} else if !strings.HasPrefix(slashPath, "/") {
		slashPath = "/" + slashPath
	}
	u := &url.URL{
		Scheme: "file",
		Path:   slashPath,
	}
	return u.String()
}

// GenerateManifest scans outputDir for .class files, extracts binary names and hashes,
// and maps each artifact to its corresponding source file in projectRoot.
func GenerateManifest(outputDir, projectRoot, projectID string, prevManifest *BuildArtifactManifest) (*BuildArtifactManifest, error) {
	if outputDir == "" {
		return nil, errors.New("outputDir required")
	}
	absOut, err := filepath.Abs(outputDir)
	if err != nil {
		return nil, err
	}

	var artifacts []ArtifactItem
	var skipped []string
	err = filepath.Walk(absOut, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil || info == nil || info.IsDir() {
			return walkErr
		}
		if !strings.HasSuffix(info.Name(), ".class") {
			return nil
		}

		data, readErr := os.ReadFile(path)
		if readErr != nil {
			skipped = append(skipped, path)
			return nil
		}

		classInfo, parseErr := ParseClassFile(data)
		if parseErr != nil {
			skipped = append(skipped, path)
			return nil
		}

		sum := sha256.Sum256(data)
		hashStr := hex.EncodeToString(sum[:])

		// Find corresponding source file
		topLevel := classInfo.BinaryName
		if idx := strings.Index(topLevel, "$"); idx >= 0 {
			topLevel = topLevel[:idx]
		}
		relSource := strings.ReplaceAll(topLevel, ".", string(filepath.Separator)) + ".java"
		sourcePath := ""

		if projectRoot != "" {
			absRoot, _ := filepath.Abs(projectRoot)
			candidate := filepath.Join(absRoot, relSource)
			if _, statErr := os.Stat(candidate); statErr == nil {
				sourcePath = candidate
			} else {
				// Search common source directories: src, src/main/java
				candidates := []string{
					filepath.Join(absRoot, "src", relSource),
					filepath.Join(absRoot, "src", "main", "java", relSource),
				}
				for _, c := range candidates {
					if _, statErr := os.Stat(c); statErr == nil {
						sourcePath = c
						break
					}
				}
			}
		}

		sourceURI := pathToURI(sourcePath)
		artifactURI := pathToURI(path)

		artifacts = append(artifacts, ArtifactItem{
			BinaryName:   classInfo.BinaryName,
			SourceURI:    sourceURI,
			SourcePath:   sourcePath,
			ArtifactURI:  artifactURI,
			ArtifactPath: path,
			SHA256:       hashStr,
			MajorVersion: classInfo.MajorVersion,
		})
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("walk outputDir: %w", err)
	}

	sort.Slice(artifacts, func(i, j int) bool {
		return artifacts[i].BinaryName < artifacts[j].BinaryName
	})

	var removed []string
	if prevManifest != nil {
		currentSet := make(map[string]bool)
		for _, art := range artifacts {
			currentSet[art.BinaryName] = true
		}
		for _, oldArt := range prevManifest.Artifacts {
			if !currentSet[oldArt.BinaryName] {
				removed = append(removed, oldArt.BinaryName)
			}
		}
	}

	h := sha256.New()
	_, _ = fmt.Fprintf(h, "project:%s\n", projectID)
	_, _ = fmt.Fprintf(h, "root:%s\n", filepath.ToSlash(projectRoot))
	for _, art := range artifacts {
		_, _ = fmt.Fprintf(h, "art:%s:%s\n", art.BinaryName, art.SHA256)
	}
	buildID := fmt.Sprintf("build-%x", h.Sum(nil)[:16])

	return &BuildArtifactManifest{
		BuildID:          buildID,
		ProjectID:        projectID,
		CompletedAt:      time.Now(),
		Artifacts:        artifacts,
		RemovedArtifacts: removed,
		SkippedArtifacts: skipped,
	}, nil
}
