// Copyright 2024, Command Line Inc.
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

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"golang.org/x/crypto/ssh"
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

	return strings.TrimSpace(string(out)), nil
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

func GetClientOs(client *ssh.Client) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}

	out, unixErr := session.CombinedOutput("uname -s")
	if unixErr == nil {
		formatted := strings.ToLower(string(out))
		formatted = strings.TrimSpace(formatted)
		return formatted, nil
	}

	session, err = client.NewSession()
	if err != nil {
		return "", err
	}

	out, cmdErr := session.Output("echo %OS%")
	if cmdErr == nil {
		formatted := strings.ToLower(string(out))
		formatted = strings.TrimSpace(formatted)
		return strings.Split(formatted, "_")[0], nil
	}

	session, err = client.NewSession()
	if err != nil {
		return "", err
	}

	out, psErr := session.Output("echo $env:OS")
	if psErr == nil {
		formatted := strings.ToLower(string(out))
		formatted = strings.TrimSpace(formatted)
		return strings.Split(formatted, "_")[0], nil
	}
	return "", fmt.Errorf("unable to determine os: {unix: %s, cmd: %s, powershell: %s}", unixErr, cmdErr, psErr)
}

func GetClientArch(client *ssh.Client) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}

	out, unixErr := session.CombinedOutput("uname -m")
	if unixErr == nil {
		return utilfn.FilterValidArch(string(out))
	}

	session, err = client.NewSession()
	if err != nil {
		return "", err
	}

	out, cmdErr := session.CombinedOutput("echo %PROCESSOR_ARCHITECTURE%")
	if cmdErr == nil && strings.TrimSpace(string(out)) != "%PROCESSOR_ARCHITECTURE%" {
		return utilfn.FilterValidArch(string(out))
	}

	session, err = client.NewSession()
	if err != nil {
		return "", err
	}

	out, psErr := session.CombinedOutput("echo $env:PROCESSOR_ARCHITECTURE")
	if psErr == nil && strings.TrimSpace(string(out)) != "$env:PROCESSOR_ARCHITECTURE" {
		return utilfn.FilterValidArch(string(out))
	}
	return "", fmt.Errorf("unable to determine architecture: {unix: %s, cmd: %s, powershell: %s}", unixErr, cmdErr, psErr)
}

var installTemplateRawDefault = strings.TrimSpace(`
mkdir -p {{.installDir}} || exit 1
cat > {{.tempPath}} || exit 1
mv {{.tempPath}} {{.installPath}} || exit 1
chmod a+x {{.installPath}} || exit 1
`)
var installTemplate = template.Must(template.New("wsh-install-template").Parse(installTemplateRawDefault))

func CpHostToRemote(ctx context.Context, client *ssh.Client, sourcePath string, destPath string) error {
	installWords := map[string]string{
		"installDir":  filepath.ToSlash(filepath.Dir(destPath)),
		"tempPath":    filepath.ToSlash(destPath + ".temp"),
		"installPath": filepath.ToSlash(destPath),
	}

	var installCmd bytes.Buffer
	if err := installTemplate.Execute(&installCmd, installWords); err != nil {
		return fmt.Errorf("failed to prepare install command: %w", err)
	}

	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w", err)
	}
	defer session.Close()

	// Add stderr capture
	var stderr bytes.Buffer
	session.Stderr = &stderr

	stdin, err := session.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	if err := session.Start(installCmd.String()); err != nil {
		return fmt.Errorf("failed to start remote command: %w", err)
	}

	input, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("cannot open local file %s: %w", sourcePath, err)
	}
	defer input.Close()

	copyDone := make(chan error, 1)

	go func() {
		defer close(copyDone)
		defer stdin.Close()

		_, err := io.Copy(stdin, input)
		if err != nil && err != io.EOF {
			copyDone <- err
			return
		}
		copyDone <- nil
	}()

	select {
	case <-ctx.Done():
		session.Close()
		return ctx.Err()
	case err := <-copyDone:
		if err != nil {
			return fmt.Errorf("failed to copy data: %w", err)
		}
	}

	if err := session.Wait(); err != nil {
		return fmt.Errorf("remote command failed: %w (stderr: %s)", err, stderr.String())
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
