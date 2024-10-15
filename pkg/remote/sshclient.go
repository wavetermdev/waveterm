// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/kevinburke/ssh_config"
	"github.com/skeema/knownhosts"
	"github.com/wavetermdev/waveterm/pkg/trimquotes"
	"github.com/wavetermdev/waveterm/pkg/userinput"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	xknownhosts "golang.org/x/crypto/ssh/knownhosts"
)

type UserInputCancelError struct {
	Err error
}

type HostKeyAlgorithms = func(hostWithPort string) (algos []string)

func (uice UserInputCancelError) Error() string {
	return uice.Err.Error()
}

// This exists to trick the ssh library into continuing to try
// different public keys even when the current key cannot be
// properly parsed
func createDummySigner() ([]ssh.Signer, error) {
	dummyKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	dummySigner, err := ssh.NewSignerFromKey(dummyKey)
	if err != nil {
		return nil, err
	}
	return []ssh.Signer{dummySigner}, nil

}

// This is a workaround to only process one identity file at a time,
// even if they have passphrases. It must be combined with retryable
// authentication to work properly
//
// Despite returning an array of signers, we only ever provide one since
// it allows proper user interaction in between attempts
//
// A significant number of errors end up returning dummy values as if
// they were successes. An error in this function prevents any other
// keys from being attempted. But if there's an error because of a dummy
// file, the library can still try again with a new key.
func createPublicKeyCallback(connCtx context.Context, sshKeywords *SshKeywords, authSockSignersExt []ssh.Signer, agentClient agent.ExtendedAgent) func() ([]ssh.Signer, error) {
	var identityFiles []string
	existingKeys := make(map[string][]byte)

	// checking the file early prevents us from needing to send a
	// dummy signer if there's a problem with the signer
	for _, identityFile := range sshKeywords.IdentityFile {
		filePath, err := wavebase.ExpandHomeDir(identityFile)
		if err != nil {
			continue
		}
		privateKey, err := os.ReadFile(filePath)
		if err != nil {
			// skip this key and try with the next
			continue
		}
		existingKeys[identityFile] = privateKey
		identityFiles = append(identityFiles, identityFile)
	}
	// require pointer to modify list in closure
	identityFilesPtr := &identityFiles

	var authSockSigners []ssh.Signer
	authSockSigners = append(authSockSigners, authSockSignersExt...)
	authSockSignersPtr := &authSockSigners

	return func() ([]ssh.Signer, error) {
		// try auth sock
		if len(*authSockSignersPtr) != 0 {
			authSockSigner := (*authSockSignersPtr)[0]
			*authSockSignersPtr = (*authSockSignersPtr)[1:]
			return []ssh.Signer{authSockSigner}, nil
		}

		if len(*identityFilesPtr) == 0 {
			return nil, fmt.Errorf("no identity files remaining")
		}
		identityFile := (*identityFilesPtr)[0]
		*identityFilesPtr = (*identityFilesPtr)[1:]
		privateKey, ok := existingKeys[identityFile]
		if !ok {
			log.Printf("error with existingKeys, this should never happen")
			// skip this key and try with the next
			return createDummySigner()
		}

		unencryptedPrivateKey, err := ssh.ParseRawPrivateKey(privateKey)
		if err == nil {
			signer, err := ssh.NewSignerFromKey(unencryptedPrivateKey)
			if err == nil {
				if sshKeywords.AddKeysToAgent && agentClient != nil {
					agentClient.Add(agent.AddedKey{
						PrivateKey: unencryptedPrivateKey,
					})
				}
				return []ssh.Signer{signer}, err
			}
		}
		if _, ok := err.(*ssh.PassphraseMissingError); !ok {
			// skip this key and try with the next
			return createDummySigner()
		}

		// batch mode deactivates user input
		if sshKeywords.BatchMode {
			// skip this key and try with the next
			return createDummySigner()
		}

		request := &userinput.UserInputRequest{
			ResponseType: "text",
			QueryText:    fmt.Sprintf("Enter passphrase for the SSH key: %s", identityFile),
			Title:        "Publickey Auth + Passphrase",
		}
		ctx, cancelFn := context.WithTimeout(connCtx, 60*time.Second)
		defer cancelFn()
		response, err := userinput.GetUserInput(ctx, request)
		if err != nil {
			// this is an error where we actually do want to stop
			// trying keys
			return nil, UserInputCancelError{Err: err}
		}
		unencryptedPrivateKey, err = ssh.ParseRawPrivateKeyWithPassphrase(privateKey, []byte([]byte(response.Text)))
		if err != nil {
			// skip this key and try with the next
			return createDummySigner()
		}
		signer, err := ssh.NewSignerFromKey(unencryptedPrivateKey)
		if err != nil {
			// skip this key and try with the next
			return createDummySigner()
		}
		if sshKeywords.AddKeysToAgent && agentClient != nil {
			agentClient.Add(agent.AddedKey{
				PrivateKey: unencryptedPrivateKey,
			})
		}
		return []ssh.Signer{signer}, err
	}
}

func createInteractivePasswordCallbackPrompt(connCtx context.Context, remoteDisplayName string) func() (secret string, err error) {
	return func() (secret string, err error) {
		ctx, cancelFn := context.WithTimeout(connCtx, 60*time.Second)
		defer cancelFn()
		queryText := fmt.Sprintf(
			"Password Authentication requested from connection  \n"+
				"%s\n\n"+
				"Password:", remoteDisplayName)
		request := &userinput.UserInputRequest{
			ResponseType: "text",
			QueryText:    queryText,
			Markdown:     true,
			Title:        "Password Authentication",
		}
		response, err := userinput.GetUserInput(ctx, request)
		if err != nil {
			return "", err
		}
		return response.Text, nil
	}
}

func createInteractiveKbdInteractiveChallenge(connCtx context.Context, remoteName string) func(name, instruction string, questions []string, echos []bool) (answers []string, err error) {
	return func(name, instruction string, questions []string, echos []bool) (answers []string, err error) {
		if len(questions) != len(echos) {
			return nil, fmt.Errorf("bad response from server: questions has len %d, echos has len %d", len(questions), len(echos))
		}
		for i, question := range questions {
			echo := echos[i]
			answer, err := promptChallengeQuestion(connCtx, question, echo, remoteName)
			if err != nil {
				return nil, err
			}
			answers = append(answers, answer)
		}
		return answers, nil
	}
}

func promptChallengeQuestion(connCtx context.Context, question string, echo bool, remoteName string) (answer string, err error) {
	// limited to 15 seconds for some reason. this should be investigated more
	// in the future
	ctx, cancelFn := context.WithTimeout(connCtx, 60*time.Second)
	defer cancelFn()
	queryText := fmt.Sprintf(
		"Keyboard Interactive Authentication requested from connection  \n"+
			"%s\n\n"+
			"%s", remoteName, question)
	request := &userinput.UserInputRequest{
		ResponseType: "text",
		QueryText:    queryText,
		Markdown:     true,
		Title:        "Keyboard Interactive Authentication",
		PublicText:   echo,
	}
	response, err := userinput.GetUserInput(ctx, request)
	if err != nil {
		return "", err
	}
	return response.Text, nil
}

func openKnownHostsForEdit(knownHostsFilename string) (*os.File, error) {
	path, _ := filepath.Split(knownHostsFilename)
	err := os.MkdirAll(path, 0700)
	if err != nil {
		return nil, err
	}
	return os.OpenFile(knownHostsFilename, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
}

func writeToKnownHosts(knownHostsFile string, newLine string, getUserVerification func() (*userinput.UserInputResponse, error)) error {
	if getUserVerification == nil {
		getUserVerification = func() (*userinput.UserInputResponse, error) {
			return &userinput.UserInputResponse{
				Type:    "confirm",
				Confirm: true,
			}, nil
		}
	}

	path, _ := filepath.Split(knownHostsFile)
	err := os.MkdirAll(path, 0700)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(knownHostsFile, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
	if err != nil {
		return err
	}
	// do not close writeable files with defer

	// this file works, so let's ask the user for permission
	response, err := getUserVerification()
	if err != nil {
		f.Close()
		return UserInputCancelError{Err: err}
	}
	if !response.Confirm {
		f.Close()
		return UserInputCancelError{Err: fmt.Errorf("canceled by the user")}
	}

	_, err = f.WriteString(newLine + "\n")
	if err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func createUnknownKeyVerifier(knownHostsFile string, hostname string, remote string, key ssh.PublicKey) func() (*userinput.UserInputResponse, error) {
	base64Key := base64.StdEncoding.EncodeToString(key.Marshal())
	queryText := fmt.Sprintf(
		"The authenticity of host '%s (%s)' can't be established "+
			"as it **does not exist in any checked known_hosts files**. "+
			"The host you are attempting to connect to provides this %s key:  \n"+
			"%s.\n\n"+
			"**Would you like to continue connecting?** If so, the key will be permanently "+
			"added to the file %s "+
			"to protect from future man-in-the-middle attacks.", hostname, remote, key.Type(), base64Key, knownHostsFile)
	request := &userinput.UserInputRequest{
		ResponseType: "confirm",
		QueryText:    queryText,
		Markdown:     true,
		Title:        "Known Hosts Key Missing",
	}
	return func() (*userinput.UserInputResponse, error) {
		ctx, cancelFn := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelFn()
		return userinput.GetUserInput(ctx, request)
	}
}

func createMissingKnownHostsVerifier(knownHostsFile string, hostname string, remote string, key ssh.PublicKey) func() (*userinput.UserInputResponse, error) {
	base64Key := base64.StdEncoding.EncodeToString(key.Marshal())
	queryText := fmt.Sprintf(
		"The authenticity of host '%s (%s)' can't be established "+
			"as **no known_hosts files could be found**. "+
			"The host you are attempting to connect to provides this %s key:  \n"+
			"%s.\n\n"+
			"**Would you like to continue connecting?** If so:  \n"+
			"- %s will be created  \n"+
			"- the key will be added to %s\n\n"+
			"This will protect from future man-in-the-middle attacks.", hostname, remote, key.Type(), base64Key, knownHostsFile, knownHostsFile)
	request := &userinput.UserInputRequest{
		ResponseType: "confirm",
		QueryText:    queryText,
		Markdown:     true,
		Title:        "Known Hosts File Missing",
	}
	return func() (*userinput.UserInputResponse, error) {
		ctx, cancelFn := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelFn()
		return userinput.GetUserInput(ctx, request)
	}
}

func lineContainsMatch(line []byte, matches [][]byte) bool {
	for _, match := range matches {
		if bytes.Contains(line, match) {
			return true
		}
	}
	return false
}

func createHostKeyCallback(opts *SSHOpts) (ssh.HostKeyCallback, HostKeyAlgorithms, error) {
	ssh_config.ReloadConfigs()
	rawUserKnownHostsFiles, _ := ssh_config.GetStrict(opts.SSHHost, "UserKnownHostsFile")
	userKnownHostsFiles := strings.Fields(rawUserKnownHostsFiles) // TODO - smarter splitting escaped spaces and quotes
	rawGlobalKnownHostsFiles, _ := ssh_config.GetStrict(opts.SSHHost, "GlobalKnownHostsFile")
	globalKnownHostsFiles := strings.Fields(rawGlobalKnownHostsFiles) // TODO - smarter splitting escaped spaces and quotes

	osUser, err := user.Current()
	if err != nil {
		return nil, nil, err
	}
	var unexpandedKnownHostsFiles []string
	if osUser.Username == "root" {
		unexpandedKnownHostsFiles = globalKnownHostsFiles
	} else {
		unexpandedKnownHostsFiles = append(userKnownHostsFiles, globalKnownHostsFiles...)
	}

	var knownHostsFiles []string
	for _, filename := range unexpandedKnownHostsFiles {
		filePath, err := wavebase.ExpandHomeDir(filename)
		if err != nil {
			continue
		}
		knownHostsFiles = append(knownHostsFiles, filePath)
	}

	// there are no good known hosts files
	if len(knownHostsFiles) == 0 {
		return nil, nil, fmt.Errorf("no known_hosts files provided by ssh. defaults are overridden")
	}

	var unreadableFiles []string

	// the library we use isn't very forgiving about files that are formatted
	// incorrectly. if a problem file is found, it is removed from our list
	// and we try again
	var basicCallback ssh.HostKeyCallback
	var hostKeyAlgorithms HostKeyAlgorithms
	for basicCallback == nil && len(knownHostsFiles) > 0 {
		keyDb, err := knownhosts.NewDB(knownHostsFiles...)
		if serr, ok := err.(*os.PathError); ok {
			badFile := serr.Path
			unreadableFiles = append(unreadableFiles, badFile)
			var okFiles []string
			for _, filename := range knownHostsFiles {
				if filename != badFile {
					okFiles = append(okFiles, filename)
				}
			}
			if len(okFiles) >= len(knownHostsFiles) {
				return nil, nil, fmt.Errorf("problem file (%s) doesn't exist. this should not be possible", badFile)
			}
			knownHostsFiles = okFiles
		} else if err != nil {
			// TODO handle obscure problems if possible
			return nil, nil, fmt.Errorf("known_hosts formatting error: %+v", err)
		} else {
			basicCallback = keyDb.HostKeyCallback()
			hostKeyAlgorithms = keyDb.HostKeyAlgorithms
		}
	}

	if basicCallback == nil {
		basicCallback = func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			return &xknownhosts.KeyError{}
		}
		// need to return nil here to avoid null pointer from attempting to call
		// the one provided by the db if nothing was found
		hostKeyAlgorithms = func(hostWithPort string) (algos []string) {
			return nil
		}
	}

	waveHostKeyCallback := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := basicCallback(hostname, remote, key)
		if err == nil {
			// success
			return nil
		} else if _, ok := err.(*xknownhosts.RevokedError); ok {
			// revoked credentials are refused outright
			return err
		} else if _, ok := err.(*xknownhosts.KeyError); !ok {
			// this is an unknown error (note the !ok is opposite of usual)
			return err
		}
		serr, _ := err.(*xknownhosts.KeyError)
		if len(serr.Want) == 0 {
			// the key was not found

			// try to write to a file that could be read
			err := fmt.Errorf("placeholder, should not be returned") // a null value here can cause problems with empty slice
			for _, filename := range knownHostsFiles {
				newLine := xknownhosts.Line([]string{xknownhosts.Normalize(hostname)}, key)
				getUserVerification := createUnknownKeyVerifier(filename, hostname, remote.String(), key)
				err = writeToKnownHosts(filename, newLine, getUserVerification)
				if err == nil {
					break
				}
				if serr, ok := err.(UserInputCancelError); ok {
					return serr
				}
			}

			// try to write to a file that could not be read (file likely doesn't exist)
			// should catch cases where there is no known_hosts file
			if err != nil {
				for _, filename := range unreadableFiles {
					newLine := xknownhosts.Line([]string{xknownhosts.Normalize(hostname)}, key)
					getUserVerification := createMissingKnownHostsVerifier(filename, hostname, remote.String(), key)
					err = writeToKnownHosts(filename, newLine, getUserVerification)
					if err == nil {
						knownHostsFiles = []string{filename}
						break
					}
					if serr, ok := err.(UserInputCancelError); ok {
						return serr
					}
				}
			}
			if err != nil {
				return fmt.Errorf("unable to create new knownhost key: %e", err)
			}
		} else {
			// the key changed
			correctKeyFingerprint := base64.StdEncoding.EncodeToString(key.Marshal())
			var bulletListKnownHosts []string
			for _, knownHostName := range knownHostsFiles {
				withBulletPoint := "- " + knownHostName
				bulletListKnownHosts = append(bulletListKnownHosts, withBulletPoint)
			}
			var offendingKeysFmt []string
			for _, badKey := range serr.Want {
				formattedKey := "- " + base64.StdEncoding.EncodeToString(badKey.Key.Marshal())
				offendingKeysFmt = append(offendingKeysFmt, formattedKey)
			}
			// todo
			errorMsg := fmt.Sprintf("**WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!**\n\n"+
				"If this is not expected, it is possible that someone could be trying to "+
				"eavesdrop on you via a man-in-the-middle attack. "+
				"Alternatively, the host you are connecting to may have changed its key. "+
				"The %s key sent by the remote hist has the fingerprint:  \n"+
				"%s\n\n"+
				"If you are sure this is correct, please update your known_hosts files to "+
				"remove the lines with the offending before trying to connect again.  \n"+
				"**Known Hosts Files**  \n"+
				"%s\n\n"+
				"**Offending Keys**  \n"+
				"%s", key.Type(), correctKeyFingerprint, strings.Join(bulletListKnownHosts, "  \n"), strings.Join(offendingKeysFmt, "  \n"))
			log.Print(errorMsg)
			//update := scbus.MakeUpdatePacket()
			// create update into alert message

			//send update via bus?
			return fmt.Errorf("remote host identification has changed")
		}

		updatedCallback, err := xknownhosts.New(knownHostsFiles...)
		if err != nil {
			return err
		}
		// try one final time
		return updatedCallback(hostname, remote, key)
	}

	return waveHostKeyCallback, hostKeyAlgorithms, nil
}

func DialContext(ctx context.Context, network string, addr string, config *ssh.ClientConfig) (*ssh.Client, error) {
	d := net.Dialer{Timeout: config.Timeout}
	conn, err := d.DialContext(ctx, network, addr)
	if err != nil {
		return nil, err
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, config)
	if err != nil {
		return nil, err
	}
	return ssh.NewClient(c, chans, reqs), nil
}

func ConnectToClient(connCtx context.Context, opts *SSHOpts) (*ssh.Client, error) {
	sshConfigKeywords, err := findSshConfigKeywords(opts.SSHHost)
	if err != nil {
		return nil, err
	}

	sshKeywords, err := combineSshKeywords(opts, sshConfigKeywords)
	if err != nil {
		return nil, err
	}
	remoteName := sshKeywords.User + "@" + xknownhosts.Normalize(sshKeywords.HostName+":"+sshKeywords.Port)

	var authSockSigners []ssh.Signer
	var agentClient agent.ExtendedAgent
	conn, err := net.Dial("unix", sshKeywords.IdentityAgent)
	if err != nil {
		log.Printf("Failed to open Identity Agent Socket: %v", err)
	} else {
		agentClient = agent.NewClient(conn)
		authSockSigners, _ = agentClient.Signers()
	}

	publicKeyCallback := ssh.PublicKeysCallback(createPublicKeyCallback(connCtx, sshKeywords, authSockSigners, agentClient))
	keyboardInteractive := ssh.KeyboardInteractive(createInteractiveKbdInteractiveChallenge(connCtx, remoteName))
	passwordCallback := ssh.PasswordCallback(createInteractivePasswordCallbackPrompt(connCtx, remoteName))

	// exclude gssapi-with-mic and hostbased until implemented
	authMethodMap := map[string]ssh.AuthMethod{
		"publickey":            ssh.RetryableAuthMethod(publicKeyCallback, len(sshKeywords.IdentityFile)+len(authSockSigners)),
		"keyboard-interactive": ssh.RetryableAuthMethod(keyboardInteractive, 1),
		"password":             ssh.RetryableAuthMethod(passwordCallback, 1),
	}

	// note: batch mode turns off interactive input
	authMethodActiveMap := map[string]bool{
		"publickey":            sshKeywords.PubkeyAuthentication,
		"keyboard-interactive": sshKeywords.KbdInteractiveAuthentication && !sshKeywords.BatchMode,
		"password":             sshKeywords.PasswordAuthentication && !sshKeywords.BatchMode,
	}

	var authMethods []ssh.AuthMethod
	for _, authMethodName := range sshKeywords.PreferredAuthentications {
		authMethodActive, ok := authMethodActiveMap[authMethodName]
		if !ok || !authMethodActive {
			continue
		}
		authMethod, ok := authMethodMap[authMethodName]
		if !ok {
			continue
		}
		authMethods = append(authMethods, authMethod)
	}

	hostKeyCallback, hostKeyAlgorithms, err := createHostKeyCallback(opts)
	if err != nil {
		return nil, err
	}

	networkAddr := sshKeywords.HostName + ":" + sshKeywords.Port
	clientConfig := &ssh.ClientConfig{
		User:              sshKeywords.User,
		Auth:              authMethods,
		HostKeyCallback:   hostKeyCallback,
		HostKeyAlgorithms: hostKeyAlgorithms(networkAddr),
	}
	return DialContext(connCtx, "tcp", networkAddr, clientConfig)
}

type SshKeywords struct {
	User                         string
	HostName                     string
	Port                         string
	IdentityFile                 []string
	BatchMode                    bool
	PubkeyAuthentication         bool
	PasswordAuthentication       bool
	KbdInteractiveAuthentication bool
	PreferredAuthentications     []string
	AddKeysToAgent               bool
	IdentityAgent                string
}

func combineSshKeywords(opts *SSHOpts, configKeywords *SshKeywords) (*SshKeywords, error) {
	sshKeywords := &SshKeywords{}

	if opts.SSHUser != "" {
		sshKeywords.User = opts.SSHUser
	} else if configKeywords.User != "" {
		sshKeywords.User = configKeywords.User
	} else {
		user, err := user.Current()
		if err != nil {
			return nil, fmt.Errorf("failed to get user for ssh: %+v", err)
		}
		sshKeywords.User = user.Username
	}

	// we have to check the host value because of the weird way
	// we store the pattern as the hostname for imported remotes
	if configKeywords.HostName != "" {
		sshKeywords.HostName = configKeywords.HostName
	} else {
		sshKeywords.HostName = opts.SSHHost
	}

	if opts.SSHPort != 0 && opts.SSHPort != 22 {
		sshKeywords.Port = strconv.Itoa(opts.SSHPort)
	} else if configKeywords.Port != "" && configKeywords.Port != "22" {
		sshKeywords.Port = configKeywords.Port
	} else {
		sshKeywords.Port = "22"
	}

	sshKeywords.IdentityFile = configKeywords.IdentityFile

	// these are not officially supported in the waveterm frontend but can be configured
	// in ssh config files
	sshKeywords.BatchMode = configKeywords.BatchMode
	sshKeywords.PubkeyAuthentication = configKeywords.PubkeyAuthentication
	sshKeywords.PasswordAuthentication = configKeywords.PasswordAuthentication
	sshKeywords.KbdInteractiveAuthentication = configKeywords.KbdInteractiveAuthentication
	sshKeywords.PreferredAuthentications = configKeywords.PreferredAuthentications
	sshKeywords.AddKeysToAgent = configKeywords.AddKeysToAgent
	sshKeywords.IdentityAgent = configKeywords.IdentityAgent

	return sshKeywords, nil
}

// note that a `var == "yes"` will default to false
// but `var != "no"` will default to true
// when given unexpected strings
func findSshConfigKeywords(hostPattern string) (*SshKeywords, error) {
	ssh_config.ReloadConfigs()
	sshKeywords := &SshKeywords{}
	var err error

	userRaw, err := ssh_config.GetStrict(hostPattern, "User")
	if err != nil {
		return nil, err
	}
	sshKeywords.User = trimquotes.TryTrimQuotes(userRaw)

	hostNameRaw, err := ssh_config.GetStrict(hostPattern, "HostName")
	if err != nil {
		return nil, err
	}
	sshKeywords.HostName = trimquotes.TryTrimQuotes(hostNameRaw)

	portRaw, err := ssh_config.GetStrict(hostPattern, "Port")
	if err != nil {
		return nil, err
	}
	sshKeywords.Port = trimquotes.TryTrimQuotes(portRaw)

	identityFileRaw := ssh_config.GetAll(hostPattern, "IdentityFile")
	for i := 0; i < len(identityFileRaw); i++ {
		identityFileRaw[i] = trimquotes.TryTrimQuotes(identityFileRaw[i])
	}
	sshKeywords.IdentityFile = identityFileRaw

	batchModeRaw, err := ssh_config.GetStrict(hostPattern, "BatchMode")
	if err != nil {
		return nil, err
	}
	sshKeywords.BatchMode = (strings.ToLower(trimquotes.TryTrimQuotes(batchModeRaw)) == "yes")

	// we currently do not support host-bound or unbound but will use yes when they are selected
	pubkeyAuthenticationRaw, err := ssh_config.GetStrict(hostPattern, "PubkeyAuthentication")
	if err != nil {
		return nil, err
	}
	sshKeywords.PubkeyAuthentication = (strings.ToLower(trimquotes.TryTrimQuotes(pubkeyAuthenticationRaw)) != "no")

	passwordAuthenticationRaw, err := ssh_config.GetStrict(hostPattern, "PasswordAuthentication")
	if err != nil {
		return nil, err
	}
	sshKeywords.PasswordAuthentication = (strings.ToLower(trimquotes.TryTrimQuotes(passwordAuthenticationRaw)) != "no")

	kbdInteractiveAuthenticationRaw, err := ssh_config.GetStrict(hostPattern, "KbdInteractiveAuthentication")
	if err != nil {
		return nil, err
	}
	sshKeywords.KbdInteractiveAuthentication = (strings.ToLower(trimquotes.TryTrimQuotes(kbdInteractiveAuthenticationRaw)) != "no")

	// these are parsed as a single string and must be separated
	// these are case sensitive in openssh so they are here too
	preferredAuthenticationsRaw, err := ssh_config.GetStrict(hostPattern, "PreferredAuthentications")
	if err != nil {
		return nil, err
	}
	sshKeywords.PreferredAuthentications = strings.Split(trimquotes.TryTrimQuotes(preferredAuthenticationsRaw), ",")
	addKeysToAgentRaw, err := ssh_config.GetStrict(hostPattern, "AddKeysToAgent")
	if err != nil {
		return nil, err
	}
	sshKeywords.AddKeysToAgent = (strings.ToLower(trimquotes.TryTrimQuotes(addKeysToAgentRaw)) == "yes")

	identityAgentRaw, err := ssh_config.GetStrict(hostPattern, "IdentityAgent")
	if err != nil {
		return nil, err
	}
	if identityAgentRaw == "" {
		shellPath := shellutil.DetectLocalShellPath()
		authSockCommand := exec.Command(shellPath, "-c", "echo ${SSH_AUTH_SOCK}")
		sshAuthSock, err := authSockCommand.Output()
		if err == nil {
			agentPath, err := wavebase.ExpandHomeDir(trimquotes.TryTrimQuotes(strings.TrimSpace(string(sshAuthSock))))
			if err != nil {
				return nil, err
			}
			sshKeywords.IdentityAgent = agentPath
		} else {
			log.Printf("unable to find SSH_AUTH_SOCK: %v\n", err)
		}
	} else {
		agentPath, err := wavebase.ExpandHomeDir(trimquotes.TryTrimQuotes(identityAgentRaw))
		if err != nil {
			return nil, err
		}
		sshKeywords.IdentityAgent = agentPath
	}

	return sshKeywords, nil
}

type SSHOpts struct {
	SSHHost string `json:"sshhost"`
	SSHUser string `json:"sshuser"`
	SSHPort int    `json:"sshport,omitempty"`
}

func (opts SSHOpts) String() string {
	stringRepr := ""
	if opts.SSHUser != "" {
		stringRepr = opts.SSHUser + "@"
	}
	stringRepr = stringRepr + opts.SSHHost
	if opts.SSHPort != 0 {
		stringRepr = stringRepr + ":" + fmt.Sprint(opts.SSHPort)
	}
	return stringRepr
}
