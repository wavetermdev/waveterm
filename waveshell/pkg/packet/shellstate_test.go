package packet

import "testing"

func TestShellVersions(t *testing.T) {
	if !StateVersionsCompatible("bash v5.0.17", "bash v5.0.17") {
		t.Errorf("versions should be compatible")
	}
	if !StateVersionsCompatible("bash v5.0.17", "bash v5.0.18") {
		t.Errorf("versions should be compatible")
	}
	if !StateVersionsCompatible("bash v5.0.17", "bash v5.1.0") {
		t.Errorf("versions should be compatible")
	}
	if StateVersionsCompatible("bash v5.0.17", "bash v6.0.0") {
		t.Errorf("versions should not be compatible")
	}
	if StateVersionsCompatible("bash v5.0.17", "zsh v5.0.17") {
		t.Errorf("versions should not be compatible")
	}

	shell, version, err := ParseShellStateVersion("bash v5.0.17")
	if err != nil {
		t.Errorf("version should be valid, got error %v", err)
	}
	if shell != ShellType_bash {
		t.Errorf("shell should be bash")
	}
	if version != "v5.0.17" {
		t.Errorf("version should be v5.0.17")
	}
	shell, version, err = ParseShellStateVersion("zsh v5.0.17")
	if err != nil {
		t.Errorf("version should be valid, got error %v", err)
	}
	if shell != ShellType_zsh {
		t.Errorf("shell should be zsh")
	}
	if version != "v5.0.17" {
		t.Errorf("version should be v5.0.17")
	}
	_, _, err = ParseShellStateVersion("fish v5.0.17")
	if err == nil {
		t.Errorf("version should be invalid")
	}
	_, _, err = ParseShellStateVersion("bash v5.0.17.1")
	if err == nil {
		t.Errorf("version should be invalid")
	}
	_, _, err = ParseShellStateVersion("bash")
	if err == nil {
		t.Errorf("version should be invalid")
	}
	_, _, err = ParseShellStateVersion("bash v5.0.17 extrastuff")
	if err == nil {
		t.Errorf("version should be invalid")
	}
}
