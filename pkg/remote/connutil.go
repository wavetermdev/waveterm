// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"

	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"golang.org/x/crypto/ssh"
	"golang.org/x/mod/semver"
)

var userHostRe = regexp.MustCompile(`^([a-zA-Z0-9][a-zA-Z0-9._@\\-]*@)?([a-zA-Z0-9][a-zA-Z0-9.-]*)(?::([0-9]+))?$`)

func ParseOpts(input string) (*SSHOpts, error) {
	m := userHostRe.FindStringSubmatch(input)
	if m == nil {
		return nil, fmt.Errorf("invalid format of user@host argument")
	}
	remoteUser, remoteHost, remotePort := m[1], m[2], m[3]
	remoteUser = strings.Trim(remoteUser, "@")

	return &SSHOpts{SSHHost: remoteHost, SSHUser: remoteUser, SSHPort: remotePort}, nil
}

func DetectShell(client *ssh.Client) (string, error) {
	wshPath := GetWshPath(client)

	session, err := client.NewSession()
	if err != nil {
		return "", err
	}

	log.Printf("shell detecting using command: %s shell", wshPath)
	out, err := session.Output(wshPath + " shell")
	if err != nil {
		log.Printf("unable to determine shell. defaulting to /bin/bash: %s", err)
		return "/bin/bash", nil
	}
	log.Printf("detecting shell: %s", out)

	return fmt.Sprintf(`"%s"`, strings.TrimSpace(string(out))), nil
}

// returns a valid semver version string
func GetWshVersion(client *ssh.Client) (string, error) {
	wshPath := GetWshPath(client)

	session, err := client.NewSession()
	if err != nil {
		return "", err
	}

	out, err := session.Output(wshPath + " version")
	if err != nil {
		return "", err
	}
	// output is expected to be in the form of "wsh v0.10.4"
	// should strip off the "wsh" prefix, and return a semver object
	fields := strings.Fields(strings.TrimSpace(string(out)))
	if len(fields) != 2 {
		return "", fmt.Errorf("unexpected output from wsh version: %s", out)
	}
	wshVersion := strings.TrimSpace(fields[1])
	if !semver.IsValid(wshVersion) {
		return "", fmt.Errorf("invalid semver version: %s", wshVersion)
	}
	return wshVersion, nil
}

func GetWshPath(client *ssh.Client) string {
	defaultPath := wavebase.RemoteFullWshBinPath
	session, err := client.NewSession()
	if err != nil {
		log.Printf("unable to detect client's wsh path. using default. error: %v", err)
		return defaultPath
	}

	out, whichErr := session.Output("which wsh")
	if whichErr == nil {
		return strings.TrimSpace(string(out))
	}

	session, err = client.NewSession()
	if err != nil {
		log.Printf("unable to detect client's wsh path. using default. error: %v", err)
		return defaultPath
	}

	out, whereErr := session.Output("where.exe wsh")
	if whereErr == nil {
		return strings.TrimSpace(string(out))
	}

	// check cmd on windows since it requires an absolute path with backslashes
	session, err = client.NewSession()
	if err != nil {
		log.Printf("unable to detect client's wsh path. using default. error: %v", err)
		return defaultPath
	}

	out, cmdErr := session.Output("(dir 2>&1 *``|echo %userprofile%\\.waveterm%\\.waveterm\\bin\\wsh.exe);&<# rem #>echo none") //todo
	if cmdErr == nil && strings.TrimSpace(string(out)) != "none" {
		return strings.TrimSpace(string(out))
	}

	// no custom install, use default path
	return defaultPath
}

func hasBashInstalled(client *ssh.Client) (bool, error) {
	session, err := client.NewSession()
	if err != nil {
		// this is a true error that should stop further progress
		return false, err
	}

	out, whichErr := session.Output("which bash")
	if whichErr == nil && len(out) != 0 {
		return true, nil
	}

	session, err = client.NewSession()
	if err != nil {
		// this is a true error that should stop further progress
		return false, err
	}

	out, whereErr := session.Output("where.exe bash")
	if whereErr == nil && len(out) != 0 {
		return true, nil
	}

	// note: we could also check in /bin/bash explicitly
	// just in case that wasn't added to the path. but if
	// that's true, we will most likely have worse
	// problems going forward

	return false, nil
}

func normalizeOs(os string) string {
	os = strings.ToLower(strings.TrimSpace(os))
	return os
}

func normalizeArch(arch string) string {
	arch = strings.ToLower(strings.TrimSpace(arch))
	switch arch {
	case "x86_64", "amd64":
		arch = "x64"
	case "arm64", "aarch64":
		arch = "arm64"
	}
	return arch
}

// returns (os, arch, error)
// guaranteed to return a supported platform
func GetClientPlatform(ctx context.Context, shell genconn.ShellClient) (string, string, error) {
	stdout, stderr, err := genconn.RunSimpleCommand(ctx, shell, genconn.CommandSpec{
		Cmd: "uname -sm",
	})
	if err != nil {
		return "", "", fmt.Errorf("error running uname -sm: %w, stderr: %s", err, stderr)
	}
	// Parse and normalize output
	parts := strings.Fields(strings.ToLower(strings.TrimSpace(stdout)))
	if len(parts) != 2 {
		return "", "", fmt.Errorf("unexpected output from uname: %s", stdout)
	}
	os, arch := normalizeOs(parts[0]), normalizeArch(parts[1])
	if err := wavebase.ValidateWshSupportedArch(os, arch); err != nil {
		return "", "", err
	}
	return os, arch, nil
}

var installTemplateRawDefault = strings.TrimSpace(`
mkdir -p {{.installDir}} || exit 1
cat > {{.tempPath}} || exit 1
mv {{.tempPath}} {{.installPath}} || exit 1
chmod a+x {{.installPath}} || exit 1
`)
var installTemplate = template.Must(template.New("wsh-install-template").Parse(installTemplateRawDefault))

func CpWshToRemote(ctx context.Context, client *ssh.Client, clientOs string, clientArch string) error {
	wshLocalPath, err := shellutil.GetWshBinaryPath(wavebase.WaveVersion, clientOs, clientArch)
	if err != nil {
		return err
	}
	input, err := os.Open(wshLocalPath)
	if err != nil {
		return fmt.Errorf("cannot open local file %s: %w", wshLocalPath, err)
	}
	defer input.Close()
	installWords := map[string]string{
		"installDir":  filepath.ToSlash(filepath.Dir(wavebase.RemoteFullWshBinPath)),
		"tempPath":    filepath.ToSlash(wavebase.RemoteFullWshBinPath + ".temp"),
		"installPath": filepath.ToSlash(wavebase.RemoteFullWshBinPath),
	}
	var installCmd bytes.Buffer
	if err := installTemplate.Execute(&installCmd, installWords); err != nil {
		return fmt.Errorf("failed to prepare install command: %w", err)
	}
	genCmd, err := genconn.MakeSSHCmdClient(client, genconn.CommandSpec{
		Cmd: installCmd.String(),
	})
	if err != nil {
		return fmt.Errorf("failed to create remote command: %w", err)
	}
	stdin, err := genCmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}
	defer stdin.Close()
	stderrBuf, err := genconn.MakeStderrSyncBuffer(genCmd)
	if err != nil {
		return fmt.Errorf("failed to get stderr pipe: %w", err)
	}
	if err := genCmd.Start(); err != nil {
		return fmt.Errorf("failed to start remote command: %w", err)
	}
	copyDone := make(chan error, 1)
	go func() {
		defer close(copyDone)
		defer stdin.Close()
		if _, err := io.Copy(stdin, input); err != nil && err != io.EOF {
			copyDone <- fmt.Errorf("failed to copy data: %w", err)
		} else {
			copyDone <- nil
		}
	}()
	procErr := genconn.ProcessContextWait(ctx, genCmd)
	if procErr != nil {
		return fmt.Errorf("remote command failed: %w (stderr: %s)", procErr, stderrBuf.String())
	}
	copyErr := <-copyDone
	if copyErr != nil {
		return fmt.Errorf("failed to copy data: %w (stderr: %s)", copyErr, stderrBuf.String())
	}
	return nil
}

func InstallClientRcFiles(client *ssh.Client) error {
	path := GetWshPath(client)
	log.Printf("path to wsh searched is: %s", path)
	session, err := client.NewSession()
	if err != nil {
		// this is a true error that should stop further progress
		return err
	}

	_, err = session.Output(path + " rcfiles")
	return err
}

func GetHomeDir(client *ssh.Client) string {
	session, err := client.NewSession()
	if err != nil {
		return "~"
	}
	out, err := session.Output(`echo "$HOME"`)
	if err == nil {
		return strings.TrimSpace(string(out))
	}
	return "~"
}

func IsPowershell(shellPath string) bool {
	// get the base path, and then check contains
	shellBase := filepath.Base(shellPath)
	return strings.Contains(shellBase, "powershell") || strings.Contains(shellBase, "pwsh")
}

func NormalizeConfigPattern(pattern string) string {
	userName, err := WaveSshConfigUserSettings().GetStrict(pattern, "User")
	if err != nil || userName == "" {
		log.Printf("warning: error parsing username of %s for conn dropdown: %v", pattern, err)
		localUser, err := user.Current()
		if err == nil {
			userName = localUser.Username
		}
	}
	port, err := WaveSshConfigUserSettings().GetStrict(pattern, "Port")
	if err != nil {
		port = "22"
	}
	if userName != "" {
		userName += "@"
	}
	if port == "22" {
		port = ""
	} else {
		port = ":" + port
	}
	return fmt.Sprintf("%s%s%s", userName, pattern, port)
}
