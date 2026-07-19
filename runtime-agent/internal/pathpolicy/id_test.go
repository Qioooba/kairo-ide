package pathpolicy

import (
	"strings"
	"testing"
)

var (
	validWS  = "ws_xv3wp6ifsxuk3hbrlqq2g6t2fe"
	validPrj = "prj_zlb53e7oaqja4icecicppujqnq"
	validBld = "bld_nzr4jjyg3rzbkev2uuapsmlqai"
	validSrv = "srv_4m2qdgu2pl6nhwcrdgcn5ehn5u"
)

func TestNewCryptoIDGenerator(t *testing.T) {
	gen := NewCryptoIDGenerator()

	t.Run("WorkspaceID", func(t *testing.T) {
		id, err := gen.NewWorkspaceID()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if err := ValidateWorkspaceID(id); err != nil {
			t.Fatalf("generated id should be valid: %v", err)
		}
		if !strings.HasPrefix(id, wsPrefix) {
			t.Errorf("expected prefix %s, got %s", wsPrefix, id)
		}
	})

	t.Run("ProjectID", func(t *testing.T) {
		id, err := gen.NewProjectID()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if err := ValidateProjectID(id); err != nil {
			t.Fatalf("generated id should be valid: %v", err)
		}
	})

	t.Run("BuildID", func(t *testing.T) {
		id, err := gen.NewBuildID()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if err := ValidateBuildID(id); err != nil {
			t.Fatalf("generated id should be valid: %v", err)
		}
	})

	t.Run("ServerID", func(t *testing.T) {
		id, err := gen.NewServerID()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if err := ValidateServerID(id); err != nil {
			t.Fatalf("generated id should be valid: %v", err)
		}
	})

	t.Run("UniqueIDs", func(t *testing.T) {
		seen := make(map[string]bool)
		for i := 0; i < 100; i++ {
			id, err := gen.NewProjectID()
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if seen[id] {
				t.Errorf("duplicate id: %s", id)
			}
			seen[id] = true
		}
	})
}

func TestValidateID_Valid(t *testing.T) {
	tests := []struct {
		name string
		id   string
		fn   func(string) error
	}{
		{"valid workspace id", validWS, ValidateWorkspaceID},
		{"valid project id", validPrj, ValidateProjectID},
		{"valid build id", validBld, ValidateBuildID},
		{"valid server id", validSrv, ValidateServerID},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.fn(tt.id); err != nil {
				t.Errorf("expected %q to be valid, got error: %v", tt.id, err)
			}
		})
	}
}

func TestValidateID_Invalid(t *testing.T) {
	tests := []struct {
		name string
		id   string
		fn   func(string) error
	}{
		{"empty workspace id", "", ValidateWorkspaceID},
		{"empty project id", "", ValidateProjectID},
		{"empty build id", "", ValidateBuildID},
		{"empty server id", "", ValidateServerID},

		{"wrong prefix workspace", validPrj, ValidateWorkspaceID},
		{"wrong prefix project", validWS, ValidateProjectID},
		{"wrong prefix build", validWS, ValidateBuildID},
		{"wrong prefix server", validWS, ValidateServerID},

		{"short id ws_1", "ws_1", ValidateWorkspaceID},
		{"short id prj_1", "prj_1", ValidateProjectID},
		{"short id bld_a", "bld_a", ValidateBuildID},
		{"short id srv_x", "srv_x", ValidateServerID},

		{"path traversal in id", "ws_..abcdefghijklmnopqrstuvwxyz", ValidateProjectID},
		{"traversal in middle", "ws_abc..defghijklmnopqrstuvwxyz", ValidateProjectID},

		{"forward slash", "ws_abc/defghijklmnopqrstuvwxyz", ValidateProjectID},
		{"backslash", "ws_abc\\defghijklmnopqrstuvwxyz", ValidateProjectID},
		{"colon", "ws_abc:defghijklmnopqrstuvwxyz", ValidateProjectID},

		{"absolute path /", "/ws_xv3wp6ifsxuk3hbrlqq2g6t2fe", ValidateWorkspaceID},
		{"absolute path backslash", `\ws_xv3wp6ifsxuk3hbrlqq2g6t2fe`, ValidateWorkspaceID},

		{"windows volume C:/", "C:/ws_xv3wp6ifsxuk3hbrlqq2g6t2fe", ValidateWorkspaceID},
		{"windows volume C:\\", `C:\ws_xv3wp6ifsxuk3hbrlqq2g6t2fe`, ValidateWorkspaceID},
		{"windows volume lowercase d:/", "d:/outside", ValidateWorkspaceID},

		{"unc path forward", "//server/share", ValidateWorkspaceID},
		{"unc path backslash", `\\server\share`, ValidateWorkspaceID},

		{"uppercase prefix", "WS_xv3wp6ifsxuk3hbrlqq2g6t2fe", ValidateWorkspaceID},
		{"uppercase suffix", "ws_XV3WP6IFSXUK3HBRLQQ2G6T2FE", ValidateWorkspaceID},
		{"mixed case suffix", "ws_Xv3wp6ifsxuk3hbrlqq2g6t2f", ValidateWorkspaceID},

		{"invalid char 0", "ws_0xv3wp6ifsxuk3hbrlqq2g6t2", ValidateWorkspaceID},
		{"invalid char 1", "ws_1xv3wp6ifsxuk3hbrlqq2g6t2", ValidateWorkspaceID},
		{"invalid char 8", "ws_8xv3wp6ifsxuk3hbrlqq2g6t2", ValidateWorkspaceID},
		{"invalid char 9", "ws_9xv3wp6ifsxuk3hbrlqq2g6t2", ValidateWorkspaceID},

		{"unicode chinese", "ws_中文目录测试", ValidateWorkspaceID},
		{"unicode emoji", "ws_🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉", ValidateWorkspaceID},
		{"invalid UTF-8", "ws_\xff\xfe\xfd", ValidateWorkspaceID},

		{"wrong suffix length -1", "ws_xv3wp6ifsxuk3hbrlqq2g6t2f", ValidateWorkspaceID},
		{"wrong suffix length +1", "ws_xv3wp6ifsxuk3hbrlqq2g6t2fee", ValidateWorkspaceID},

		{"empty suffix ws_", "ws_", ValidateWorkspaceID},
		{"empty suffix prj_", "prj_", ValidateProjectID},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.fn(tt.id); err == nil {
				t.Errorf("expected error for %q", tt.id)
			}
		})
	}
}
