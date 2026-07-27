//go:build !windows
// +build !windows

package proc

import "testing"

func TestSameExecutable(t *testing.T) {
	tests := []struct {
		name string
		a    string
		b    string
		want bool
	}{
		{"both empty", "", "", false},
		{"a empty", "", "/bin/sh", false},
		{"b empty", "/bin/sh", "", false},
		{"identical", "/bin/sh", "/bin/sh", true},
		{"different", "/bin/sh", "/bin/bash", false},
		{"same with trailing slash", "/bin/sh", "/bin/sh/", true},
		{"same with dot", "/usr/bin/./sh", "/usr/bin/sh", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sameExecutable(tt.a, tt.b)
			if got != tt.want {
				t.Errorf("sameExecutable(%q, %q) = %v, want %v", tt.a, tt.b, got, tt.want)
			}
		})
	}
}