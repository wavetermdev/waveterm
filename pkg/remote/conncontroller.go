package remote

import (
	"bytes"
	"context"
	"fmt"
	"html/template"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/wavetermdev/thenextwave/pkg/userinput"
	"github.com/wavetermdev/thenextwave/pkg/util/shellutil"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"golang.org/x/crypto/ssh"
)

var userHostRe = regexp.MustCompile(`^([a-zA-Z0-9][a-zA-Z0-9._@\\-]*@)?([a-z0-9][a-z0-9.-]*)(?::([0-9]+))?$`)
var globalLock = &sync.Mutex{}
var clientControllerMap = make(map[SSHOpts]*SSHConn)

type SSHConn struct {
	Lock               *sync.Mutex
	Opts               *SSHOpts
	Client             *ssh.Client
	SockName           string
	DomainSockListener net.Listener
}

func (conn *SSHConn) Close() error {
	if conn.DomainSockListener != nil {
		conn.DomainSockListener.Close()
	}
	return conn.Client.Close()
}

func (conn *SSHConn) OpenDomainSocketListener() error {
	if conn.DomainSockListener != nil {
		return nil
	}
	randStr, err := utilfn.RandomHexString(16) // 64-bits of randomness
	if err != nil {
		return fmt.Errorf("error generating random string: %w", err)
	}
	sockName := fmt.Sprintf("/tmp/waveterm-%s.sock", randStr)
	log.Printf("remote domain socket %s %q\n", conn.Opts.String(), sockName)
	listener, err := conn.Client.ListenUnix(sockName)
	if err != nil {
		return fmt.Errorf("unable to request connection domain socket: %v", err)
	}
	conn.SockName = sockName
	conn.DomainSockListener = listener
	go func() {
		wshutil.RunWshRpcOverListener(listener)
	}()
	return nil
}

func GetConn(ctx context.Context, opts *SSHOpts) (*SSHConn, error) {
	globalLock.Lock()
	defer globalLock.Unlock()

	// attempt to retrieve if already opened
	conn, ok := clientControllerMap[*opts]
	if ok {
		return conn, nil
	}

	client, err := ConnectToClient(ctx, opts) //todo specify or remove opts
	if err != nil {
		return nil, err
	}
	conn = &SSHConn{Lock: &sync.Mutex{}, Opts: opts, Client: client}
	err = conn.OpenDomainSocketListener()
	if err != nil {
		conn.Close()
		return nil, err
	}

	// check that correct wsh extensions are installed
	expectedVersion := fmt.Sprintf("wsh v%s", wavebase.WaveVersion)
	clientVersion, err := getWshVersion(client)
	if err == nil && clientVersion == expectedVersion {
		// save successful connection to map
		clientControllerMap[*opts] = conn
		return conn, nil
	}

	var queryText string
	var title string
	if err != nil {
		queryText = "Waveterm requires `wsh` shell extensions installed on your client to ensure a seamless experience. Would you like to install them?"
		title = "Install Wsh Shell Extensions"
	} else {
		queryText = fmt.Sprintf("Waveterm requires `wsh` shell extensions installed on your client to be updated from %s to %s. Would you like to update?", clientVersion, expectedVersion)
		title = "Update Wsh Shell Extensions"

	}

	request := &userinput.UserInputRequest{
		ResponseType: "confirm",
		QueryText:    queryText,
		Title:        title,
		CheckBoxMsg:  "Don't show me this again",
	}
	response, err := userinput.GetUserInput(ctx, request)
	if err != nil || !response.Confirm {
		return nil, err
	}

	log.Printf("attempting to install wsh to `%s@%s`", client.User(), client.RemoteAddr().String())

	clientOs, err := getClientOs(client)
	if err != nil {
		return nil, err
	}

	clientArch, err := getClientArch(client)
	if err != nil {
		return nil, err
	}

	// attempt to install extension
	wshLocalPath := shellutil.GetWshBinaryPath(wavebase.WaveVersion, clientOs, clientArch)
	err = cpHostToRemote(client, wshLocalPath, "~/.waveterm/bin/wsh")
	if err != nil {
		return nil, err
	}
	log.Printf("successful install")

	// save successful connection to map
	clientControllerMap[*opts] = conn

	return conn, nil
}

func DisconnectClient(opts *SSHOpts) error {
	globalLock.Lock()
	defer globalLock.Unlock()

	client, ok := clientControllerMap[*opts]
	if ok {
		return client.Close()
	}
	return fmt.Errorf("client %v not found", opts)
}

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
	wshPath := getWshPath(client)

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

func getWshVersion(client *ssh.Client) (string, error) {
	wshPath := getWshPath(client)

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

func getWshPath(client *ssh.Client) string {
	defaultPath := filepath.Join("~", ".waveterm", "bin", "wsh")

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

func getClientOs(client *ssh.Client) (string, error) {
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

func getClientArch(client *ssh.Client) (string, error) {
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

func cpHostToRemote(client *ssh.Client, sourcePath string, destPath string) error {
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
	path := getWshPath(client)

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
