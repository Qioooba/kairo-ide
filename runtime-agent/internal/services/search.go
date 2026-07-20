package services

import (
	"encoding/json"
	"fmt"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/encoding"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/search"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
)

// workspaceResolver is the minimal surface the searcher needs to
// turn a workspaceId into a filesystem root. The disk-backed
// WorkspaceStore implements it; tests can pass an in-memory stub.
type workspaceResolver interface {
	Get(id string) (api.WorkspaceRecord, error)
}

// ----------------- Searcher -----------------

type memSearcher struct {
	sandbox    *security.WorkspaceRoots
	workspaces workspaceResolver
}

func (m *memSearcher) Search(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		WorkspaceID     string   `json:"workspaceId"`
		RootPath        string   `json:"rootPath"`
		Query           string   `json:"query"`
		IsRegex         bool     `json:"isRegex"`
		CaseSensitive   bool     `json:"caseSensitive"`
		WholeWord       bool     `json:"wholeWord"`
		Include         []string `json:"include"`
		Exclude         []string `json:"exclude"`
		ContextLines    int      `json:"contextLines"`
		MaxResults      int      `json:"maxResults"`
		PreviewReplace  string   `json:"previewReplace"`
		ProjectEncoding string   `json:"projectEncoding"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	// Resolve the search root. Precedence:
	//   1. Explicit `rootPath` field (callers that already have a path)
	//   2. `workspaceId` lookup against the WorkspaceRepository
	//   3. Fall back to treating `workspaceId` as a literal path
	//      for backward compatibility with the previous behavior
	//      (which was wrong but a few tests still pass that shape).
	root := req.RootPath
	if root == "" && req.WorkspaceID != "" {
		if m != nil && m.workspaces != nil {
			if ws, err := m.workspaces.Get(req.WorkspaceID); err == nil {
				root = ws.RootPath
			}
		}
		if root == "" {
			root = req.WorkspaceID
		}
	}
	if root == "" {
		return nil, fmt.Errorf("rootPath or workspaceId is required")
	}
	if m != nil && m.sandbox != nil {
		authorized, err := m.sandbox.AuthorizeReadAbs(root)
		if err != nil {
			return nil, err
		}
		root = authorized
	}
	r, err := search.Search(root, search.Options{
		Query:           req.Query,
		IsRegex:         req.IsRegex,
		CaseSensitive:   req.CaseSensitive,
		WholeWord:       req.WholeWord,
		Include:         req.Include,
		Exclude:         req.Exclude,
		ContextLines:    req.ContextLines,
		MaxResults:      req.MaxResults,
		PreviewReplace:  req.PreviewReplace,
		ProjectEncoding: encoding.ID(req.ProjectEncoding),
	})
	if err != nil {
		return nil, err
	}
	return json.Marshal(r)
}