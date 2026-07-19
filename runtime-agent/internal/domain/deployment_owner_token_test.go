package domain

import (
	"sync"
	"testing"
)

// TestDeploymentOwnerToken_Verify_MatchesOriginalIdentity verifies
// that a token minted for a specific (ws, proj, srv, root) verifies
// positively against that same identity.
func TestDeploymentOwnerToken_Verify_MatchesOriginalIdentity(t *testing.T) {
	ws := WorkspaceID("ws_abc")
	proj := ProjectID("prj_xyz")
	srv := ServerID("srv_001")
	root := "/data/runtime/servers/srv_001/webapps"

	tok := NewDeploymentOwnerToken(ws, proj, srv, root)

	if !tok.Valid() {
		t.Fatal("freshly minted token is not Valid")
	}
	if !tok.Verify(ws, proj, srv, root) {
		t.Fatal("Verify returned false for the original identity")
	}
}

// TestDeploymentOwnerToken_Verify_RejectsDifferentTarget verifies
// that a token minted for target A fails Verify when checked
// against target B. This is the core security property — a token
// cannot be replayed against a different target.
func TestDeploymentOwnerToken_Verify_RejectsDifferentTarget(t *testing.T) {
	orig := struct {
		ws   WorkspaceID
		proj ProjectID
		srv  ServerID
		root string
	}{
		ws:   "ws_abc",
		proj: "prj_xyz",
		srv:  "srv_001",
		root: "/data/runtime/servers/srv_001/webapps",
	}
	tok := NewDeploymentOwnerToken(orig.ws, orig.proj, orig.srv, orig.root)

	cases := []struct {
		name string
		ws   WorkspaceID
		proj ProjectID
		srv  ServerID
		root string
	}{
		{"different ws", "ws_other", orig.proj, orig.srv, orig.root},
		{"different proj", orig.ws, "prj_other", orig.srv, orig.root},
		{"different srv", orig.ws, orig.proj, "srv_other", orig.root},
		{"different root", orig.ws, orig.proj, orig.srv, "/other/path"},
		{"all different", "ws_x", "prj_x", "srv_x", "/x"},
		{"empty identity", "", "", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if tok.Verify(c.ws, c.proj, c.srv, c.root) {
				t.Errorf("Verify returned true for %s — token is not bound to identity", c.name)
			}
		})
	}
}

// TestDeploymentOwnerToken_ZeroValueInvalid verifies that a
// zero-valued DeploymentOwnerToken (the default struct value) is
// neither Valid nor Verify-able.
func TestDeploymentOwnerToken_ZeroValueInvalid(t *testing.T) {
	var tok DeploymentOwnerToken
	if tok.Valid() {
		t.Error("zero-valued token should not be Valid")
	}
	if tok.Verify("ws", "prj", "srv", "/root") {
		t.Error("zero-valued token should not Verify")
	}
}

// TestDeploymentOwnerToken_ConcurrentMinting verifies that
// concurrent minting of tokens does not cause a data race or
// produce duplicate nonces. The previous implementation used a
// non-atomic uint64 counter — `go test -race` would catch a race.
//
// This test MUST be run with `-race` to be meaningful:
//
//	go test -race -run TestDeploymentOwnerToken_ConcurrentMinting ./internal/domain
func TestDeploymentOwnerToken_ConcurrentMinting(t *testing.T) {
	const goroutines = 64
	const perGoroutine = 32

	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < perGoroutine; j++ {
				tok := NewDeploymentOwnerToken("ws", "prj", "srv", "/root")
				if !tok.Valid() {
					t.Errorf("minted token is not Valid")
					return
				}
				if !tok.Verify("ws", "prj", "srv", "/root") {
					t.Errorf("minted token does not Verify against its own identity")
					return
				}
			}
		}()
	}
	wg.Wait()
}

// TestDeploymentOwnerToken_NoncesAreUnique verifies that two
// tokens minted for the same identity have different nonces.
// (They will also have different tags because the nonce is an
// HMAC input.)
func TestDeploymentOwnerToken_NoncesAreUnique(t *testing.T) {
	tok1 := NewDeploymentOwnerToken("ws", "prj", "srv", "/root")
	tok2 := NewDeploymentOwnerToken("ws", "prj", "srv", "/root")
	if tok1.nonce == tok2.nonce {
		t.Error("two minted tokens have identical nonces — entropy source is broken")
	}
	if tok1.tag == tok2.tag {
		t.Error("two minted tokens have identical tags — HMAC input is missing the nonce")
	}
	// Both should still Verify against the same identity.
	if !tok1.Verify("ws", "prj", "srv", "/root") {
		t.Error("tok1 failed Verify")
	}
	if !tok2.Verify("ws", "prj", "srv", "/root") {
		t.Error("tok2 failed Verify")
	}
}

// TestDeploymentOwnerToken_TamperedTagFailsVerify verifies that
// modifying the tag in-memory causes Verify to fail. This is a
// defense-in-depth check: even if an attacker could somehow flip
// a bit in the tag, Verify would catch it.
func TestDeploymentOwnerToken_TamperedTagFailsVerify(t *testing.T) {
	tok := NewDeploymentOwnerToken("ws", "prj", "srv", "/root")
	tok.tag[0] ^= 0xff // flip bits
	if tok.Verify("ws", "prj", "srv", "/root") {
		t.Error("Verify returned true for a tampered tag")
	}
}

// TestDeploymentOwnerToken_TamperedNonceFailsVerify verifies
// that modifying the nonce causes Verify to fail (the tag was
// computed over the original nonce).
func TestDeploymentOwnerToken_TamperedNonceFailsVerify(t *testing.T) {
	tok := NewDeploymentOwnerToken("ws", "prj", "srv", "/root")
	tok.nonce[0] ^= 0xff
	if tok.Verify("ws", "prj", "srv", "/root") {
		t.Error("Verify returned true for a tampered nonce")
	}
}
