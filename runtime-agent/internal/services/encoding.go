package services

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/atomicfile"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/encoding"
	"github.com/Qioooba/kairo-ide/runtime-agent/internal/security"
)

// ----------------- Encoder -----------------

type memEncoder struct {
	sandbox *security.WorkspaceRoots
}

func (m *memEncoder) Detect(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		WorkspaceID string `json:"workspaceId"`
		File        string `json:"file"`
		SampleBytes int    `json:"sampleBytes"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.SampleBytes == 0 {
		req.SampleBytes = 64 * 1024
	}
	// Reject paths outside the sandbox. Without this check the
	// endpoint could be used to read arbitrary files (~/.ssh,
	// /etc/passwd, …) by anyone who can reach the agent.
	path, err := m.resolveRead(req.File)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	buf := make([]byte, req.SampleBytes)
	n, _ := f.Read(buf)
	id, conf, hasBom, eol := encoding.Detect(buf[:n], encoding.UTF8, encoding.Aliases{})
	return json.Marshal(map[string]any{
		"file":       req.File,
		"encoding":   id,
		"confidence": conf,
		"candidates": []string{id},
		"hasBom":     hasBom,
		"eol":        eol,
	})
}

func (m *memEncoder) Recode(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		WorkspaceID string `json:"workspaceId"`
		File        string `json:"file"`
		From        string `json:"from"`
		To          string `json:"to"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	// Recode reads AND writes the same path. Both directions must
	// pass the sandbox or the endpoint lets a caller overwrite
	// arbitrary files.
	path, err := m.resolveWrite(req.File)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	decoded, err := encoding.Decode(data, req.From, encoding.Aliases{})
	if err != nil {
		return nil, err
	}
	encoded, err := encoding.Encode(decoded, req.To, encoding.Aliases{})
	if err != nil {
		return nil, err
	}
	// Use atomic write (temp file + fsync + rename) instead of
	// os.WriteFile in-place, which can corrupt the file on crash.
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if err := atomicfile.WriteFile(path, encoded, info.Mode()); err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"ok": true, "bytes": len(encoded)})
}

func (m *memEncoder) Validate(payload json.RawMessage) (json.RawMessage, error) {
	var req struct {
		Text     string `json:"text"`
		Encoding string `json:"encoding"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		return nil, err
	}
	if req.Text == "" {
		return json.Marshal(map[string]any{"valid": true})
	}
	// Fast path: UTF-8 always valid
	if req.Encoding == "utf-8" || req.Encoding == "UTF-8" {
		return json.Marshal(map[string]any{"valid": true})
	}
	_, err := encoding.Encode([]byte(req.Text), req.Encoding, encoding.Aliases{})
	if err != nil {
		return json.Marshal(map[string]any{
			"valid": false,
			"error": fmt.Sprintf("text cannot be represented in %s: %v", req.Encoding, err),
		})
	}
	return json.Marshal(map[string]any{"valid": true})
}

// resolveRead authorizes a caller-supplied read path. If a sandbox
// is configured the path must be under one of the workspace roots
// (or a read-only bundled path). When no sandbox is configured
// (legacy callers / tests) we fall through with the original path.
func (m *memEncoder) resolveRead(p string) (string, error) {
	if m == nil || m.sandbox == nil {
		return p, nil
	}
	return m.sandbox.AuthorizeReadAbs(p)
}

func (m *memEncoder) resolveWrite(p string) (string, error) {
	if m == nil || m.sandbox == nil {
		return p, nil
	}
	return m.sandbox.AuthorizeWriteAbs(p)
}
