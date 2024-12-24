// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"fmt"
	"html/template"
	"io"
	"log"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
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
	defaultPath := "~/.waveterm/bin/wsh"

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

	out, unixErr := session.Output("uname -s")
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

	out, unixErr := session.Output("uname -m")
	if unixErr == nil {
		formatted := strings.ToLower(string(out))
		formatted = strings.TrimSpace(formatted)
		if formatted == "x86_64" {
			return "x64", nil
		}
		return formatted, nil
	}

	session, err = client.NewSession()
	if err != nil {
		return "", err
	}

	out, cmdErr := session.Output("echo %PROCESSOR_ARCHITECTURE%")
	if cmdErr == nil {
		formatted := strings.ToLower(string(out))
		return strings.TrimSpace(formatted), nil
	}

	session, err = client.NewSession()
	if err != nil {
		return "", err
	}

	out, psErr := session.Output("echo $env:PROCESSOR_ARCHITECTURE")
	if psErr == nil {
		formatted := strings.ToLower(string(out))
		return strings.TrimSpace(formatted), nil
	}
	return "", fmt.Errorf("unable to determine architecture: {unix: %s, cmd: %s, powershell: %s}", unixErr, cmdErr, psErr)
}

var installTemplateRawBash = `bash -c ' \
mkdir -p {{.installDir}}; \
cat > {{.tempPath}}; \
mv {{.tempPath}} {{.installPath}}; \
chmod a+x {{.installPath}};' \
`

var installTemplateRawDefault = ` \
mkdir -p {{.installDir}}; \
cat > {{.tempPath}}; \
mv {{.tempPath}} {{.installPath}}; \
chmod a+x {{.installPath}}; \
`

func CpHostToRemote(client *ssh.Client, sourcePath string, destPath string) error {
	// warning: does not work on windows remote yet
	bashInstalled, err := hasBashInstalled(client)
	if err != nil {
		return err
	}

	var selectedTemplateRaw string
	if bashInstalled {
		selectedTemplateRaw = installTemplateRawBash
	} else {
		log.Printf("bash is not installed on remote. attempting with default shell")
		selectedTemplateRaw = installTemplateRawDefault
	}

	// I need to use toSlash here to force unix keybindings
	// this means we can't guarantee it will work on a remote windows machine
	var installWords = map[string]string{
		"installDir":  filepath.ToSlash(filepath.Dir(destPath)),
		"tempPath":    destPath + ".temp",
		"installPath": destPath,
	}

	installCmd := &bytes.Buffer{}
	installTemplate := template.Must(template.New("").Parse(selectedTemplateRaw))
	installTemplate.Execute(installCmd, installWords)

	session, err := client.NewSession()
	if err != nil {
		return err
	}

	installStdin, err := session.StdinPipe()
	if err != nil {
		return err
	}

	err = session.Start(installCmd.String())
	if err != nil {
		return err
	}

	input, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("cannot open local file %s to send to host: %v", sourcePath, err)
	}

	go func() {
		defer panichandler.PanicHandler("connutil:CpHostToRemote")
		io.Copy(installStdin, input)
		session.Close() // this allows the command to complete for reasons i don't fully understand
	}()

	return session.Wait()
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

	session, err = client.NewSession()
	if err != nil {
		return "~"
	}
	out, err = session.Output(`echo %userprofile%`)
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
