package services

import (
	"encoding/json"

	"github.com/kairo-ide/runtime-agent/internal/jdtproject"
	"github.com/kairo-ide/runtime-agent/internal/log"
)

// ----------------- JDTProjectGenerator (project model) -----------------
//
// The JDT LS needs an Eclipse-shaped project model on disk
// to produce Java language features. The Generator below
// reads .legacyflow/project.yaml and writes the model under
// the runtime data dir. See internal/jdtproject for the
// schema and the XML/INI renderers.

type jdtprojectService struct {
	gen *jdtproject.Generator
}

func newJDTProjectService(dataDir, bundled string, logger *log.Logger) *jdtprojectService {
	g := jdtproject.NewGenerator(dataDir, bundled)
	g.Logger = func(msg string, fields map[string]any) {
		if logger != nil {
			logger.Info(msg, log.Fields(fields))
		}
	}
	return &jdtprojectService{gen: g}
}

func (s *jdtprojectService) Generate(payload json.RawMessage) (json.RawMessage, error) {
	res, err := s.gen.Generate(payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(res)
}

func (s *jdtprojectService) Status(workspaceID string) (json.RawMessage, error) {
	st, err := s.gen.Status(workspaceID)
	if err != nil {
		return nil, err
	}
	return json.Marshal(st)
}
