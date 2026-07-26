package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/antpath"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
)

// handleAntClasspathAnalyze handles GET/POST /api/v1/ant/classpath/analyze
func (s *Server) handleAntClasspathAnalyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodGet {
		writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: "GET or POST only"})
		return
	}

	var req struct {
		ProjectRoot string `json:"projectRoot"`
		BuildFile   string `json:"buildFile"`
	}

	if r.Method == http.MethodPost {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, "", "", protocol.KairoError{Code: protocol.ErrInvalidRequest, Message: err.Error()})
			return
		}
	} else {
		// GET: read from query params
		req.ProjectRoot = r.URL.Query().Get("projectRoot")
		req.BuildFile = r.URL.Query().Get("buildFile")
	}

	if req.ProjectRoot == "" {
		writeOK(w, protocol.RequestEnvelope{}, map[string]interface{}{
			"success":  false,
			"message":  "projectRoot is required (no active project)",
			"classpath": []string{},
			"warnings": []map[string]interface{}{
				{"message": "No active project to analyze", "severity": "info"},
			},
		})
		return
	}

	// Find build.xml
	buildFile := req.BuildFile
	if buildFile == "" {
		candidates := []string{
			filepath.Join(req.ProjectRoot, "build.xml"),
			filepath.Join(req.ProjectRoot, "build", "build.xml"),
		}
		for _, c := range candidates {
			if _, err := os.Stat(c); err == nil {
				buildFile = c
				break
			}
		}
	} else if !filepath.IsAbs(buildFile) {
		buildFile = filepath.Join(req.ProjectRoot, buildFile)
	}

	if buildFile == "" {
		writeOK(w, protocol.RequestEnvelope{}, map[string]interface{}{
			"success":  false,
			"message":  "No build.xml found in project root",
			"classpath": []string{},
			"warnings": []map[string]interface{}{
				{"message": "No build.xml found", "severity": "warning"},
			},
		})
		return
	}

	// Resolve classpath
	result, err := antpath.Resolve(buildFile)
	if err != nil {
		writeOK(w, protocol.RequestEnvelope{}, map[string]interface{}{
			"success":   false,
			"buildFile": buildFile,
			"message":   err.Error(),
			"classpath": []string{},
			"warnings": []map[string]interface{}{
				{"message": err.Error(), "severity": "error"},
			},
		})
		return
	}

	// Build response
	response := map[string]interface{}{
		"success":        true,
		"buildFile":      buildFile,
		"classpath":      result.Classpath,
		"classpathCount": len(result.Classpath),
		"sourceRoots":    result.SourceRoots,
		"outputDir":      result.OutputDir,
		"properties":     result.Properties,
		"warnings":       result.Warnings,
	}

	writeOK(w, protocol.RequestEnvelope{}, response)
}