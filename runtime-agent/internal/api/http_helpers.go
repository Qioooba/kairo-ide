package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/Qioooba/kairo-ide/runtime-agent/internal/api/protocol"
)

// Shared HTTP helpers used by both the production Server routes and the
// unwired APIHandler (GO-P3-2). Kept outside //go:build unwired so default
// tests can exercise them.

// decodeEnvelopePayload decodes the envelope and extracts the typed payload.
func decodeEnvelopePayload[T any](r *http.Request, env *protocol.RequestEnvelope, dst *T) error {
	if r.Method == http.MethodGet || r.Method == http.MethodDelete {
		env.RequestID = r.Header.Get("X-Kairo-Request-Id")
		if env.RequestID == "" {
			env.RequestID = newRequestID()
		}
		env.CorrelationID = r.Header.Get("X-Kairo-Correlation-Id")
		env.WorkspaceID = r.Header.Get("X-Kairo-Workspace-Id")
		return fmt.Errorf("no body for %s request", r.Method)
	}
	body, err := decodeBodyBytes(r)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, env); err != nil {
		return fmt.Errorf("decode envelope: %w", err)
	}
	if env.RequestID == "" {
		env.RequestID = r.Header.Get("X-Kairo-Request-Id")
	}
	if env.CorrelationID == "" {
		env.CorrelationID = r.Header.Get("X-Kairo-Correlation-Id")
	}
	payload := extractPayloadBytes(body)
	if err := json.Unmarshal(payload, dst); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	return nil
}

// writeJSONMeta is a helper to ensure status is set before writing error.
func writeJSONMeta(w http.ResponseWriter, status int) {
	_ = status
}

// decodeBodyBytes reads the request body into a byte slice.
func decodeBodyBytes(r *http.Request) ([]byte, error) {
	if r.Body == nil {
		return nil, fmt.Errorf("empty body")
	}
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 16*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	return body, nil
}

// extractPayloadBytes extracts the payload from a JSON body.
// If the body has a "payload" key, it returns that value.
// Otherwise, it returns the entire body.
func extractPayloadBytes(body []byte) json.RawMessage {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return body
	}
	if p, ok := raw["payload"]; ok {
		return p
	}
	return body
}
