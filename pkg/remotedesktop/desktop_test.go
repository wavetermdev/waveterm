package remotedesktop

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestViewerArgumentsAndValidation(t *testing.T) {
	rdp := Profile{Protocol: "rdp", Host: "desktop.example.test", Port: 3389, Username: "user name", Domain: "DOMAIN"}
	args, err := rdp.Args()
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "/from-stdin:force") || !strings.Contains(joined, "/cert:deny") || strings.Contains(joined, "/p:") {
		t.Fatalf("unsafe RDP args: %v", args)
	}
	for _, host := range []string{"-exec", "host /p:secret", "host\narg", "host;touch", "user@host", "https://host", "host:3389"} {
		p := rdp
		p.Host = host
		if _, err = p.Args(); err == nil {
			t.Errorf("invalid host accepted: %q", host)
		}
	}
	for _, port := range []int{-1, 0, 65536} {
		p := rdp
		p.Port = port
		if _, err = p.Args(); err == nil {
			t.Fatal("invalid port accepted")
		}
	}
	for _, host := range []string{"127.0.0.1", "2001:db8::1", "server.example"} {
		p := Profile{Protocol: "vnc", Host: host, Port: 5901}
		a, err := p.Args()
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasSuffix(a[0], "::5901") {
			t.Fatalf("VNC display confused with port: %v", a)
		}
	}
}
func TestHeadlessAndPasswordErrors(t *testing.T) {
	t.Setenv("DISPLAY", "")
	t.Setenv("WAYLAND_DISPLAY", "")
	if _, err := Default.Start(Profile{Protocol: "vnc", Host: "localhost", Port: 5900}, ""); err == nil {
		t.Fatal("headless viewer accepted")
	}
	t.Setenv("DISPLAY", ":99")
	if _, err := Default.Start(Profile{Protocol: "rdp", Host: "localhost", Port: 3389, Username: "u"}, "secret\n/inject"); err == nil {
		t.Fatal("stdin injection accepted")
	}
}

func TestViewerReceivesPasswordOnlyOnStdin(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fixture")
	}
	root := t.TempDir()
	log := filepath.Join(root, "viewer.json")
	quoted, _ := json.Marshal(log)
	script := "#!/usr/bin/python3\nimport sys,json\nwith open(" + string(quoted) + ",'w') as f:json.dump({'argv':sys.argv,'stdin':sys.stdin.read()},f)\n"
	if err := os.WriteFile(filepath.Join(root, "xfreerdp3"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", root)
	t.Setenv("DISPLAY", ":99")
	launcher := &Launcher{sessions: make(map[string]Session), processes: make(map[string]*os.Process)}
	session, err := launcher.Start(Profile{Protocol: "rdp", Name: "Test", Host: "desktop.test", Port: 3389, Username: "user"}, "dummy-password")
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		sessions := launcher.Sessions()
		if len(sessions) == 1 && !sessions[0].Running {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	data, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	var recorded struct {
		Argv  []string `json:"argv"`
		Stdin string   `json:"stdin"`
	}
	if err = json.Unmarshal(data, &recorded); err != nil {
		t.Fatal(err)
	}
	if recorded.Stdin != "dummy-password\n" || strings.Contains(strings.Join(recorded.Argv, " "), "dummy-password") {
		t.Fatal("password transport incorrect")
	}
	b, _ := json.Marshal(session)
	if strings.Contains(string(b), "dummy-password") {
		t.Fatal("password leaked into status")
	}
}
