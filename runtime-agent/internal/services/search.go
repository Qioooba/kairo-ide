package services

import (
	"encoding/json"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/encoding"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/search"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
)

// ----------------- Searcher -----------------

type memSearcher struct {
	sandbox *security.WorkspaceRoots
}

func (m *memSearcher) Search(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		WorkspaceID     string   `json:"workspaceId"`
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
	// The "workspaceId" field is actually used as a filesystem root
	// by search.Search. Authorize it before walking it, otherwise
	// the endpoint lists files in any directory the agent can read.
	root := req.WorkspaceID
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