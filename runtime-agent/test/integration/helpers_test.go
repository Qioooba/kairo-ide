// Package integration_test provides shared test helpers for
// integration tests. This file has no build tag so it is always
// compiled when the test/integration package is tested.
package integration_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"
)

func mustGetJSON(t *testing.T, url string) map[string]any {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("GET %s: %d\n%s", url, resp.StatusCode, body)
	}
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func mustPostJSON(t *testing.T, url string, payload any) map[string]any {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"requestId": "test-" + time.Now().Format("150405.000"),
		"payload":   payload,
	})
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		t.Fatalf("POST %s: %d\n%s", url, resp.StatusCode, raw)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode %s: %v\n%s", url, err, raw)
	}
	return out
}

func mustDeleteJSON(t *testing.T, url string, payload any) map[string]any {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"requestId": "test-" + time.Now().Format("150405.000"),
		"payload":   payload,
	})
	req, _ := http.NewRequest(http.MethodDelete, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		t.Fatalf("DELETE %s: %d\n%s", url, resp.StatusCode, raw)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode %s: %v\n%s", url, err, raw)
	}
	return out
}
