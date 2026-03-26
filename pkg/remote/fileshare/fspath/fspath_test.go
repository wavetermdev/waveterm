package fspath

import "testing"

func TestBase(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{`D:\package\AA.tar`, "AA.tar"},
		{`D:/package/AA.tar`, "AA.tar"},
		{"/home/user/file.txt", "file.txt"},
		{"file.txt", "file.txt"},
	}
	for _, tt := range tests {
		got := Base(tt.path)
		if got != tt.want {
			t.Errorf("Base(%q) = %q, want %q", tt.path, got, tt.want)
		}
	}
}
