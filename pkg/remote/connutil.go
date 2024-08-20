package remote

import (
	"bytes"
	"fmt"
	"html/template"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/crypto/ssh"
)

var userHostRe = regexp.MustCompile(`^([a-zA-Z0-9][a-zA-Z0-9._@\\-]*@)?([a-z0-9][a-z0-9.-]*)(?::([0-9]+))?$`)

func ParseOpts(input string) (*SSHOpts, error) {
	m := userHostRe.FindStringSubmatch(input)
	if m == nil {
		return nil, fmt.Errorf("invalid format of user@host argument")
	}
	remoteUser, remoteHost, remotePortStr := m[1], m[2], m[3]
	remoteUser = strings.Trim(remoteUser, "@")
	var remotePort int
	if remotePortStr != "" {
		var err error
		remotePort, err = strconv.Atoi(remotePortStr)
		if err != nil {
			return nil, fmt.Errorf("invalid port specified on user@host argument")
		}
	}

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
			return "amd64", nil
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

	var installWords = map[string]string{
		"installDir":  filepath.Dir(destPath),
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
		io.Copy(installStdin, input)
		session.Close() // this allows the command to complete for reasons i don't fully understand
	}()

	return session.Wait()
}

func InstallClientRcFiles(client *ssh.Client) error {
	path := GetWshPath(client)
	log.Printf("path to wsh searched is: %s", path)
	log.Printf("in bytes is: %v", []byte(path))
	log.Printf("in bytes expected would be: %v", []byte("~/.waveterm/bin/wsh"))

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

	out, err := session.Output("pwd")
	if err != nil {
		return "~"
	}
	return strings.TrimSpace(string(out))

}
