package sql

import "testing"

func TestConnectionStore_RegisterGetDelete(t *testing.T) {
	store := NewConnectionStore()
	if store.Len() != 0 {
		t.Fatalf("Len = %d, want 0", store.Len())
	}

	cfg := ConnectionConfig{
		Host:     "localhost",
		Port:     1521,
		SID:      "orcl",
		Username: "scott",
		Password: "tiger",
	}
	id := store.Register(cfg)
	if id == "" {
		t.Fatal("expected non-empty connectionId")
	}
	if store.Len() != 1 {
		t.Fatalf("Len = %d, want 1", store.Len())
	}

	got, ok := store.Get(id)
	if !ok {
		t.Fatalf("Get(%q) missing", id)
	}
	if got.Host != cfg.Host || got.Username != cfg.Username {
		t.Errorf("Get mismatch: %+v", got)
	}

	_, ok = store.Get("missing")
	if ok {
		t.Error("Get(missing) should be false")
	}

	store.Delete(id)
	if store.Len() != 0 {
		t.Fatalf("Len after Delete = %d, want 0", store.Len())
	}
}

func TestConnectionStore_IDsUnique(t *testing.T) {
	store := NewConnectionStore()
	cfg := ConnectionConfig{Host: "h", Port: 1521, SID: "orcl", Username: "u", Password: "p"}
	a := store.Register(cfg)
	b := store.Register(cfg)
	if a == b {
		t.Fatalf("expected unique ids, both %q", a)
	}
}
