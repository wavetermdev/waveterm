// Copyright 2025, Command Line Inc.
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
	"math"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/kevinburke/ssh_config"
	"github.com/skeema/knownhosts"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/trimquotes"
	"github.com/wavetermdev/waveterm/pkg/userinput"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	xknownhosts "golang.org/x/crypto/ssh/knownhosts"
)

const SshProxyJumpMaxDepth = 10

var waveSshConfigUserSettingsInternal *ssh_config.UserSettings
var configUserSettingsOnce = &sync.Once{}

func WaveSshConfigUserSettings() *ssh_config.UserSettings {
	configUserSettingsOnce.Do(func() {
		waveSshConfigUserSettingsInternal = ssh_config.DefaultUserSettings
		waveSshConfigUserSettingsInternal.IgnoreMatchDirective = true
	})
	return waveSshConfigUserSettingsInternal
}

type UserInputCancelError struct {
	Err error
}

type HostKeyAlgorithms = func(hostWithPort string) (algos []string)

func (uice UserInputCancelError) Error() string {
	return uice.Err.Error()
}

type ConnectionDebugInfo struct {
	CurrentClient *ssh.Client
	NextOpts      *SSHOpts
	JumpNum       int32
}

type ConnectionError struct {
	*ConnectionDebugInfo
	Err error
}

func (ce ConnectionError) Error() string {
	if ce.CurrentClient == nil {
		return fmt.Sprintf("Connecting to %s, Error: %v", ce.NextOpts, ce.Err)
	}
	return fmt.Sprintf("Connecting from %v to %s (jump number %d), Error: %v", ce.CurrentClient, ce.NextOpts, ce.JumpNum, ce.Err)
}

func SimpleMessageFromPossibleConnectionError(err error) string {
	if err == nil {
		return ""
	}
	if ce, ok := err.(ConnectionError); ok {
		return ce.Err.Error()
	}
	return err.Error()
}

// logSSHKeywords logs SSH configuration in a sanitized way (DEBUG level)
func logSSHKeywords(ctx context.Context, sshKeywords *wconfig.ConnKeywords) {
	blocklogger.Debugf(ctx, "[ssh-config] User: %s\n", utilfn.SafeDeref(sshKeywords.SshUser))
	blocklogger.Debugf(ctx, "[ssh-config] HostName: %s\n", maskHostName(utilfn.SafeDeref(sshKeywords.SshHostName)))
	blocklogger.Debugf(ctx, "[ssh-config] Port: %s\n", utilfn.SafeDeref(sshKeywords.SshPort))
	blocklogger.Debugf(ctx, "[ssh-config] IdentityAgent: %s\n", utilfn.SafeDeref(sshKeywords.SshIdentityAgent))
	blocklogger.Debugf(ctx, "[ssh-config] IdentitiesOnly: %v\n", utilfn.SafeDeref(sshKeywords.SshIdentitiesOnly))
	blocklogger.Debugf(ctx, "[ssh-config] IdentityFile count: %d\n", len(sshKeywords.SshIdentityFile))
	// Only log file basename, not full path for privacy
	for i, f := range sshKeywords.SshIdentityFile {
		blocklogger.Debugf(ctx, "[ssh-config]   IdentityFile[%d]: %s\n", i, filepath.Base(f))
	}
	blocklogger.Debugf(ctx, "[ssh-config] PubkeyAuthentication: %v\n", utilfn.SafeDeref(sshKeywords.SshPubkeyAuthentication))
	blocklogger.Debugf(ctx, "[ssh-config] PasswordAuthentication: %v\n", utilfn.SafeDeref(sshKeywords.SshPasswordAuthentication))
	blocklogger.Debugf(ctx, "[ssh-config] KbdInteractiveAuthentication: %v\n", utilfn.SafeDeref(sshKeywords.SshKbdInteractiveAuthentication))
	blocklogger.Debugf(ctx, "[ssh-config] PreferredAuthentications: %v\n", sshKeywords.SshPreferredAuthentications)
	blocklogger.Debugf(ctx, "[ssh-config] AddKeysToAgent: %v\n", utilfn.SafeDeref(sshKeywords.SshAddKeysToAgent))
	blocklogger.Debugf(ctx, "[ssh-config] ProxyJump: %v\n", sshKeywords.SshProxyJump)
	// Note: do not log PasswordSecretName value, only indicate if configured
	if sshKeywords.SshPasswordSecretName != nil && *sshKeywords.SshPasswordSecretName != "" {
		blocklogger.Debugf(ctx, "[ssh-config] PasswordSecretName: <configured>\n")
	}
}

// maskHostName masks hostname for privacy, showing only first 3 and last 3 characters
func maskHostName(hostname string) string {
	if hostname == "" {
		return "<empty>"
	}
	if len(hostname) <= 6 {
		return "***"
	}
	return hostname[:3] + "***" + hostname[len(hostname)-3:]
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
func createPublicKeyCallback(connCtx context.Context, sshKeywords *wconfig.ConnKeywords, authSockSignersExt []ssh.Signer, agentClient agent.ExtendedAgent, debugInfo *ConnectionDebugInfo) func() ([]ssh.Signer, error) {
	var identityFiles []string
	existingKeys := make(map[string][]byte)

	// checking the file early prevents us from needing to send a
	// dummy signer if there's a problem with the signer
	for _, identityFile := range sshKeywords.SshIdentityFile {
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

	return func() (outSigner []ssh.Signer, outErr error) {
		defer func() {
			panicErr := panichandler.PanicHandler("sshclient:publickey-callback", recover())
			if panicErr != nil {
				outErr = panicErr
			}
		}()
		// try auth sock
		if len(*authSockSignersPtr) != 0 {
			authSockSigner := (*authSockSignersPtr)[0]
			*authSockSignersPtr = (*authSockSignersPtr)[1:]
			return []ssh.Signer{authSockSigner}, nil
		}

		if len(*identityFilesPtr) == 0 {
			return nil, ConnectionError{ConnectionDebugInfo: debugInfo, Err: fmt.Errorf("no identity files remaining")}
		}
		identityFile := (*identityFilesPtr)[0]
		blocklogger.Infof(connCtx, "[conndebug] trying keyfile %q...\n", identityFile)
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
				if utilfn.SafeDeref(sshKeywords.SshAddKeysToAgent) && agentClient != nil {
					agentClient.Add(agent.AddedKey{
						PrivateKey: unencryptedPrivateKey,
					})
				}
				return []ssh.Signer{signer}, nil
			}
		}
		if _, ok := err.(*ssh.PassphraseMissingError); !ok {
			// skip this key and try with the next
			return createDummySigner()
		}

		// batch mode deactivates user input
		if utilfn.SafeDeref(sshKeywords.SshBatchMode) {
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

			return nil, ConnectionError{ConnectionDebugInfo: debugInfo, Err: UserInputCancelError{Err: err}}
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
		if utilfn.SafeDeref(sshKeywords.SshAddKeysToAgent) && agentClient != nil {
			agentClient.Add(agent.AddedKey{
				PrivateKey: unencryptedPrivateKey,
			})
		}
		return []ssh.Signer{signer}, nil
	}
}

func createPasswordCallbackPrompt(connCtx context.Context, remoteDisplayName string, password *string, debugInfo *ConnectionDebugInfo) func() (secret string, err error) {
	return func() (secret string, outErr error) {
		defer func() {
			panicErr := panichandler.PanicHandler("sshclient:password-callback", recover())
			if panicErr != nil {
				outErr = panicErr
			}
		}()
		blocklogger.Infof(connCtx, "[conndebug] Password Authentication requested from connection %s...\n", remoteDisplayName)

		if password != nil {
			blocklogger.Infof(connCtx, "[conndebug] using password from secret store, sending to ssh\n")
			return *password, nil
		}

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
			blocklogger.Infof(connCtx, "[conndebug] ERROR Password Authentication failed: %v\n", SimpleMessageFromPossibleConnectionError(err))
			return "", ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
		}
		blocklogger.Infof(connCtx, "[conndebug] got password from user, sending to ssh\n")
		return response.Text, nil
	}
}

func createInteractiveKbdInteractiveChallenge(connCtx context.Context, remoteName string, debugInfo *ConnectionDebugInfo) func(name, instruction string, questions []string, echos []bool) (answers []string, err error) {
	return func(name, instruction string, questions []string, echos []bool) (answers []string, outErr error) {
		defer func() {
			panicErr := panichandler.PanicHandler("sshclient:kbdinteractive-callback", recover())
			if panicErr != nil {
				outErr = panicErr
			}
		}()
		if len(questions) != len(echos) {
			return nil, fmt.Errorf("bad response from server: questions has len %d, echos has len %d", len(questions), len(echos))
		}
		for i, question := range questions {
			echo := echos[i]
			answer, err := promptChallengeQuestion(connCtx, question, echo, remoteName)
			if err != nil {
				return nil, ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
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

func createUnknownKeyVerifier(ctx context.Context, knownHostsFile string, hostname string, remote string, key ssh.PublicKey) func() (*userinput.UserInputResponse, error) {
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
		ctx, cancelFn := context.WithTimeout(ctx, 60*time.Second)
		defer cancelFn()
		resp, err := userinput.GetUserInput(ctx, request)
		if err != nil {
			return nil, err
		}
		if !resp.Confirm {
			return nil, fmt.Errorf("user selected no")
		}
		return resp, nil
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
		resp, err := userinput.GetUserInput(ctx, request)
		if err != nil {
			return nil, err
		}
		if !resp.Confirm {
			return nil, fmt.Errorf("user selected no")
		}
		return resp, nil
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

func createHostKeyCallback(ctx context.Context, sshKeywords *wconfig.ConnKeywords) (ssh.HostKeyCallback, HostKeyAlgorithms, error) {
	globalKnownHostsFiles := sshKeywords.SshGlobalKnownHostsFile
	userKnownHostsFiles := sshKeywords.SshUserKnownHostsFile

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

	waveHostKeyCallback := func(hostname string, remote net.Addr, key ssh.PublicKey) (outErr error) {
		defer func() {
			panicErr := panichandler.PanicHandler("sshclient:wave-hostkey-callback", recover())
			if panicErr != nil {
				outErr = panicErr
			}
		}()
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
				getUserVerification := createUnknownKeyVerifier(ctx, filename, hostname, remote.String(), key)
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

func createClientConfig(connCtx context.Context, sshKeywords *wconfig.ConnKeywords, debugInfo *ConnectionDebugInfo) (*ssh.ClientConfig, error) {
	chosenUser := utilfn.SafeDeref(sshKeywords.SshUser)
	chosenHostName := utilfn.SafeDeref(sshKeywords.SshHostName)
	chosenPort := utilfn.SafeDeref(sshKeywords.SshPort)
	remoteName := xknownhosts.Normalize(chosenHostName + ":" + chosenPort)
	if chosenUser != "" {
		remoteName = chosenUser + "@" + remoteName
	}

	// Log SSH configuration (DEBUG level)
	logSSHKeywords(connCtx, sshKeywords)

	var authSockSigners []ssh.Signer
	var agentClient agent.ExtendedAgent

	// IdentitiesOnly indicates that only the keys listed in the identity and certificate files or passed as arguments should be used, even if there are matches in the SSH Agent, PKCS11Provider, or SecurityKeyProvider. See https://man.openbsd.org/ssh_config#IdentitiesOnly
	// TODO: Update if we decide to support PKCS11Provider and SecurityKeyProvider
	agentPath := strings.TrimSpace(utilfn.SafeDeref(sshKeywords.SshIdentityAgent))
	if !utilfn.SafeDeref(sshKeywords.SshIdentitiesOnly) && agentPath != "" {
		blocklogger.Debugf(connCtx, "[ssh-agent] attempting to connect to agent at %q\n", agentPath)
		conn, err := dialIdentityAgent(agentPath)
		if err != nil {
			blocklogger.Infof(connCtx, "[ssh-agent] ERROR failed to connect to agent at %q: %v\n", agentPath, err)
			if runtime.GOOS == "windows" {
				blocklogger.Infof(connCtx, "[ssh-agent] hint: ensure OpenSSH Authentication Agent service is running (Get-Service ssh-agent)\n")
			}
		} else {
			blocklogger.Infof(connCtx, "[ssh-agent] successfully connected to agent at %q\n", agentPath)
			agentClient = agent.NewClient(conn)
			blocklogger.Debugf(connCtx, "[ssh-agent] requesting key list from agent...\n")
			var signerErr error
			authSockSigners, signerErr = agentClient.Signers()
			if signerErr != nil {
				blocklogger.Infof(connCtx, "[ssh-agent] WARNING failed to get signers from agent: %v\n", signerErr)
			} else {
				blocklogger.Infof(connCtx, "[ssh-agent] retrieved %d signers from agent\n", len(authSockSigners))
				// Log public key fingerprints (DEBUG level, for troubleshooting)
				for i, signer := range authSockSigners {
					pubKey := signer.PublicKey()
					fingerprint := ssh.FingerprintSHA256(pubKey)
					blocklogger.Debugf(connCtx, "[ssh-agent]   key[%d]: type=%s fingerprint=%s\n", i, pubKey.Type(), fingerprint)
				}
			}
		}
	} else {
		if agentPath == "" {
			blocklogger.Debugf(connCtx, "[ssh-agent] no agent path configured\n")
		} else {
			blocklogger.Debugf(connCtx, "[ssh-agent] agent skipped (IdentitiesOnly=%v)\n", utilfn.SafeDeref(sshKeywords.SshIdentitiesOnly))
		}
	}

	var sshPassword *string
	if sshKeywords.SshPasswordSecretName != nil && *sshKeywords.SshPasswordSecretName != "" {
		secretName := *sshKeywords.SshPasswordSecretName
		password, exists, err := secretstore.GetSecret(secretName)
		if err != nil {
			return nil, fmt.Errorf("error retrieving ssh:passwordsecretname %q: %w", secretName, err)
		}
		if !exists {
			return nil, fmt.Errorf("ssh:passwordsecretname %q not found in secret store", secretName)
		}
		blocklogger.Infof(connCtx, "[conndebug] successfully retrieved ssh:passwordsecretname %q from secret store\n", secretName)
		sshPassword = &password
	}

	publicKeyCallback := ssh.PublicKeysCallback(createPublicKeyCallback(connCtx, sshKeywords, authSockSigners, agentClient, debugInfo))
	keyboardInteractive := ssh.KeyboardInteractive(createInteractiveKbdInteractiveChallenge(connCtx, remoteName, debugInfo))
	passwordCallback := ssh.PasswordCallback(createPasswordCallbackPrompt(connCtx, remoteName, sshPassword, debugInfo))

	// exclude gssapi-with-mic and hostbased until implemented
	authMethodMap := map[string]ssh.AuthMethod{
		"publickey":            ssh.RetryableAuthMethod(publicKeyCallback, len(sshKeywords.SshIdentityFile)+len(authSockSigners)),
		"keyboard-interactive": ssh.RetryableAuthMethod(keyboardInteractive, 1),
		"password":             ssh.RetryableAuthMethod(passwordCallback, 1),
	}

	// note: batch mode turns off interactive input
	authMethodActiveMap := map[string]bool{
		"publickey":            utilfn.SafeDeref(sshKeywords.SshPubkeyAuthentication),
		"keyboard-interactive": utilfn.SafeDeref(sshKeywords.SshKbdInteractiveAuthentication) && !utilfn.SafeDeref(sshKeywords.SshBatchMode),
		"password":             utilfn.SafeDeref(sshKeywords.SshPasswordAuthentication) && !utilfn.SafeDeref(sshKeywords.SshBatchMode),
	}

	var authMethods []ssh.AuthMethod
	for _, authMethodName := range sshKeywords.SshPreferredAuthentications {
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

	hostKeyCallback, hostKeyAlgorithms, err := createHostKeyCallback(connCtx, sshKeywords)
	if err != nil {
		return nil, err
	}

	networkAddr := chosenHostName + ":" + chosenPort
	return &ssh.ClientConfig{
		User:              chosenUser,
		Auth:              authMethods,
		HostKeyCallback:   hostKeyCallback,
		HostKeyAlgorithms: hostKeyAlgorithms(networkAddr),
	}, nil
}

func connectInternal(ctx context.Context, networkAddr string, clientConfig *ssh.ClientConfig, currentClient *ssh.Client) (*ssh.Client, error) {
	var clientConn net.Conn
	var err error
	if currentClient == nil {
		d := net.Dialer{Timeout: clientConfig.Timeout}
		blocklogger.Infof(ctx, "[conndebug] ssh dial %s\n", networkAddr)
		clientConn, err = d.DialContext(ctx, "tcp", networkAddr)
		if err != nil {
			blocklogger.Infof(ctx, "[conndebug] ERROR dial error: %v\n", err)
			return nil, err
		}
	} else {
		blocklogger.Infof(ctx, "[conndebug] ssh dial (from client) %s\n", networkAddr)
		clientConn, err = currentClient.DialContext(ctx, "tcp", networkAddr)
		if err != nil {
			blocklogger.Infof(ctx, "[conndebug] ERROR dial error: %v\n", err)
			return nil, err
		}
	}
	c, chans, reqs, err := ssh.NewClientConn(clientConn, networkAddr, clientConfig)
	if err != nil {
		blocklogger.Infof(ctx, "[conndebug] ERROR ssh auth/negotiation: %s\n", SimpleMessageFromPossibleConnectionError(err))
		return nil, err
	}
	blocklogger.Infof(ctx, "[conndebug] successful ssh connection to %s\n", networkAddr)
	return ssh.NewClient(c, chans, reqs), nil
}

func ConnectToClient(connCtx context.Context, opts *SSHOpts, currentClient *ssh.Client, jumpNum int32, connFlags *wconfig.ConnKeywords) (*ssh.Client, int32, error) {
	blocklogger.Infof(connCtx, "[conndebug] ConnectToClient %s (jump:%d)...\n", opts.String(), jumpNum)
	debugInfo := &ConnectionDebugInfo{
		CurrentClient: currentClient,
		NextOpts:      opts,
		JumpNum:       jumpNum,
	}
	if jumpNum > SshProxyJumpMaxDepth {
		return nil, jumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: fmt.Errorf("ProxyJump %d exceeds Wave's max depth of %d", jumpNum, SshProxyJumpMaxDepth)}
	}

	rawName := opts.String()
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	internalSshConfigKeywords, ok := fullConfig.Connections[rawName]
	if !ok {
		internalSshConfigKeywords = wconfig.ConnKeywords{}
	}

	var sshConfigKeywords *wconfig.ConnKeywords
	if utilfn.SafeDeref(internalSshConfigKeywords.ConnIgnoreSshConfig) {
		blocklogger.Debugf(connCtx, "[ssh-config] loading config for host %q (ignoresshconfig=true, using defaults only)\n", opts.SSHHost)
		var err error
		sshConfigKeywords, err = findSshDefaults(opts.SSHHost)
		if err != nil {
			err = fmt.Errorf("cannot determine default config keywords: %w", err)
			return nil, debugInfo.JumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
		}
	} else {
		blocklogger.Debugf(connCtx, "[ssh-config] loading config for host %q (using ssh_config + internal)\n", opts.SSHHost)
		var err error
		sshConfigKeywords, err = findSshConfigKeywords(opts.SSHHost)
		if err != nil {
			err = fmt.Errorf("cannot determine config keywords: %w", err)
			return nil, debugInfo.JumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
		}
	}

	parsedKeywords := &wconfig.ConnKeywords{}
	if opts.SSHUser != "" {
		parsedKeywords.SshUser = &opts.SSHUser
	}
	if opts.SSHPort != "" {
		parsedKeywords.SshPort = &opts.SSHPort
	}

	// cascade order:
	//   ssh config -> (optional) internal config -> specified flag keywords -> parsed keywords
	partialMerged := sshConfigKeywords
	partialMerged = mergeKeywords(partialMerged, &internalSshConfigKeywords)
	partialMerged = mergeKeywords(partialMerged, connFlags)
	sshKeywords := mergeKeywords(partialMerged, parsedKeywords)

	// handle these separately since
	// - they append
	// - since they append, the order is reversed
	// - there is no reason to not include the internal config
	// - they are never part of the parsedKeywords
	sshKeywords.SshIdentityFile = append(sshKeywords.SshIdentityFile, connFlags.SshIdentityFile...)
	sshKeywords.SshIdentityFile = append(sshKeywords.SshIdentityFile, internalSshConfigKeywords.SshIdentityFile...)
	sshKeywords.SshIdentityFile = append(sshKeywords.SshIdentityFile, sshConfigKeywords.SshIdentityFile...)

	for _, proxyName := range sshKeywords.SshProxyJump {
		proxyOpts, err := ParseOpts(proxyName)
		if err != nil {
			return nil, debugInfo.JumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
		}

		// ensure no overflow (this will likely never happen)
		if jumpNum < math.MaxInt32 {
			jumpNum += 1
		}

		// do not apply supplied keywords to proxies - ssh config must be used for that
		debugInfo.CurrentClient, jumpNum, err = ConnectToClient(connCtx, proxyOpts, debugInfo.CurrentClient, jumpNum, &wconfig.ConnKeywords{})
		if err != nil {
			// do not add a context on a recursive call
			// (this can cause a recursive nested context that's arbitrarily deep)
			return nil, jumpNum, err
		}
	}
	clientConfig, err := createClientConfig(connCtx, sshKeywords, debugInfo)
	if err != nil {
		return nil, debugInfo.JumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
	}
	networkAddr := utilfn.SafeDeref(sshKeywords.SshHostName) + ":" + utilfn.SafeDeref(sshKeywords.SshPort)
	client, err := connectInternal(connCtx, networkAddr, clientConfig, debugInfo.CurrentClient)
	if err != nil {
		return client, debugInfo.JumpNum, ConnectionError{ConnectionDebugInfo: debugInfo, Err: err}
	}
	return client, debugInfo.JumpNum, nil
}

// note that a `var == "yes"` will default to false
// but `var != "no"` will default to true
// when given unexpected strings
func findSshConfigKeywords(hostPattern string) (connKeywords *wconfig.ConnKeywords, outErr error) {
	defer func() {
		panicErr := panichandler.PanicHandler("sshclient:find-ssh-config-keywords", recover())
		if panicErr != nil {
			outErr = panicErr
		}
	}()
	WaveSshConfigUserSettings().ReloadConfigs()
	sshKeywords := &wconfig.ConnKeywords{}
	var err error

	userRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "User")
	if err != nil {
		return nil, err
	}
	userClean := trimquotes.TryTrimQuotes(userRaw)
	if userClean == "" {
		userDetails, err := user.Current()
		if err != nil {
			return nil, err
		}
		userClean = userDetails.Username
	}
	sshKeywords.SshUser = &userClean

	hostNameRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "HostName")
	if err != nil {
		return nil, err
	}
	// manually implementing default HostName here as it is not handled by ssh_config library
	hostNameProcessed := trimquotes.TryTrimQuotes(hostNameRaw)
	if hostNameProcessed == "" {
		sshKeywords.SshHostName = &hostPattern
	} else {
		sshKeywords.SshHostName = &hostNameRaw
	}

	portRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "Port")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshPort = utilfn.Ptr(trimquotes.TryTrimQuotes(portRaw))

	identityFileRaw := WaveSshConfigUserSettings().GetAll(hostPattern, "IdentityFile")
	for i := 0; i < len(identityFileRaw); i++ {
		identityFileRaw[i] = trimquotes.TryTrimQuotes(identityFileRaw[i])
	}
	sshKeywords.SshIdentityFile = identityFileRaw

	batchModeRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "BatchMode")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshBatchMode = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(batchModeRaw)) == "yes")

	// we currently do not support host-bound or unbound but will use yes when they are selected
	pubkeyAuthenticationRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "PubkeyAuthentication")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshPubkeyAuthentication = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(pubkeyAuthenticationRaw)) != "no")

	passwordAuthenticationRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "PasswordAuthentication")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshPasswordAuthentication = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(passwordAuthenticationRaw)) != "no")

	kbdInteractiveAuthenticationRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "KbdInteractiveAuthentication")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshKbdInteractiveAuthentication = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(kbdInteractiveAuthenticationRaw)) != "no")

	// these are parsed as a single string and must be separated
	// these are case sensitive in openssh so they are here too
	preferredAuthenticationsRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "PreferredAuthentications")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshPreferredAuthentications = strings.Split(trimquotes.TryTrimQuotes(preferredAuthenticationsRaw), ",")
	addKeysToAgentRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "AddKeysToAgent")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshAddKeysToAgent = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(addKeysToAgentRaw)) == "yes")

	identitiesOnly, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "IdentitiesOnly")
	if err != nil {
		return nil, err
	}
	sshKeywords.SshIdentitiesOnly = utilfn.Ptr(strings.ToLower(trimquotes.TryTrimQuotes(identitiesOnly)) == "yes")

	identityAgentRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "IdentityAgent")
	if err != nil {
		return nil, err
	}
	if identityAgentRaw == "" {
		if runtime.GOOS == "windows" {
			sshKeywords.SshIdentityAgent = utilfn.Ptr(`\\.\pipe\openssh-ssh-agent`)
		} else {
			shellPath := shellutil.DetectLocalShellPath()
			authSockCommand := exec.Command(shellPath, "-c", "echo ${SSH_AUTH_SOCK}")
			sshAuthSock, err := authSockCommand.Output()
			if err == nil {
				trimmedSock := strings.TrimSpace(string(sshAuthSock))
				if trimmedSock == "" {
					log.Printf("SSH_AUTH_SOCK is empty in shell environment")
				} else {
					agentPath, err := wavebase.ExpandHomeDir(trimquotes.TryTrimQuotes(trimmedSock))
					if err != nil {
						return nil, err
					}
					sshKeywords.SshIdentityAgent = utilfn.Ptr(agentPath)
				}
			} else {
				log.Printf("unable to find SSH_AUTH_SOCK: %v\n", err)
			}
		}
	} else {
		agentPath, err := wavebase.ExpandHomeDir(trimquotes.TryTrimQuotes(identityAgentRaw))
		if err != nil {
			return nil, err
		}
		sshKeywords.SshIdentityAgent = utilfn.Ptr(agentPath)
	}

	proxyJumpRaw, err := WaveSshConfigUserSettings().GetStrict(hostPattern, "ProxyJump")
	if err != nil {
		return nil, err
	}
	proxyJumpSplit := strings.Split(proxyJumpRaw, ",")
	for _, proxyJumpName := range proxyJumpSplit {
		proxyJumpName = strings.TrimSpace(proxyJumpName)
		if proxyJumpName == "" || strings.ToLower(proxyJumpName) == "none" {
			continue
		}
		sshKeywords.SshProxyJump = append(sshKeywords.SshProxyJump, proxyJumpName)
	}
	rawUserKnownHostsFile, _ := WaveSshConfigUserSettings().GetStrict(hostPattern, "UserKnownHostsFile")
	sshKeywords.SshUserKnownHostsFile = strings.Fields(rawUserKnownHostsFile) // TODO - smarter splitting escaped spaces and quotes
	rawGlobalKnownHostsFile, _ := WaveSshConfigUserSettings().GetStrict(hostPattern, "GlobalKnownHostsFile")
	sshKeywords.SshGlobalKnownHostsFile = strings.Fields(rawGlobalKnownHostsFile) // TODO - smarter splitting escaped spaces and quotes

	return sshKeywords, nil
}

func findSshDefaults(hostPattern string) (connKeywords *wconfig.ConnKeywords, outErr error) {
	sshKeywords := &wconfig.ConnKeywords{}

	userDetails, err := user.Current()
	if err != nil {
		return nil, err
	}
	sshKeywords.SshUser = &userDetails.Username
	sshKeywords.SshHostName = &hostPattern
	sshKeywords.SshPort = utilfn.Ptr(ssh_config.Default("Port"))
	sshKeywords.SshIdentityFile = ssh_config.DefaultAll("IdentityFile", hostPattern, ssh_config.DefaultUserSettings) // use the sshconfig here. should be different later
	sshKeywords.SshBatchMode = utilfn.Ptr(false)
	sshKeywords.SshPubkeyAuthentication = utilfn.Ptr(true)
	sshKeywords.SshPasswordAuthentication = utilfn.Ptr(true)
	sshKeywords.SshKbdInteractiveAuthentication = utilfn.Ptr(true)
	sshKeywords.SshPreferredAuthentications = strings.Split(ssh_config.Default("PreferredAuthentications"), ",")
	sshKeywords.SshAddKeysToAgent = utilfn.Ptr(false)
	sshKeywords.SshIdentitiesOnly = utilfn.Ptr(false)
	sshKeywords.SshIdentityAgent = utilfn.Ptr(ssh_config.Default("IdentityAgent"))
	sshKeywords.SshProxyJump = []string{}
	sshKeywords.SshUserKnownHostsFile = strings.Fields(ssh_config.Default("UserKnownHostsFile"))
	sshKeywords.SshGlobalKnownHostsFile = strings.Fields(ssh_config.Default("GlobalKnownHostsFile"))
	return sshKeywords, nil
}

type SSHOpts struct {
	SSHHost string `json:"sshhost"`
	SSHUser string `json:"sshuser"`
	SSHPort string `json:"sshport,omitempty"`
}

func (opts SSHOpts) String() string {
	stringRepr := ""
	if opts.SSHUser != "" {
		stringRepr = opts.SSHUser + "@"
	}
	stringRepr = stringRepr + opts.SSHHost
	if opts.SSHPort != "22" && opts.SSHPort != "" {
		stringRepr = stringRepr + ":" + fmt.Sprint(opts.SSHPort)
	}
	return stringRepr
}

func mergeKeywords(oldKeywords *wconfig.ConnKeywords, newKeywords *wconfig.ConnKeywords) *wconfig.ConnKeywords {
	if oldKeywords == nil {
		oldKeywords = &wconfig.ConnKeywords{}
	}
	if newKeywords == nil {
		return oldKeywords
	}
	outKeywords := *oldKeywords

	if newKeywords.SshHostName != nil {
		outKeywords.SshHostName = newKeywords.SshHostName
	}
	if newKeywords.SshUser != nil {
		outKeywords.SshUser = newKeywords.SshUser
	}
	if newKeywords.SshPort != nil {
		outKeywords.SshPort = newKeywords.SshPort
	}
	// skip identityfile (handled separately due to different behavior)
	if newKeywords.SshBatchMode != nil {
		outKeywords.SshBatchMode = newKeywords.SshBatchMode
	}
	if newKeywords.SshPubkeyAuthentication != nil {
		outKeywords.SshPubkeyAuthentication = newKeywords.SshPubkeyAuthentication
	}
	if newKeywords.SshPasswordAuthentication != nil {
		outKeywords.SshPasswordAuthentication = newKeywords.SshPasswordAuthentication
	}
	if newKeywords.SshKbdInteractiveAuthentication != nil {
		outKeywords.SshKbdInteractiveAuthentication = newKeywords.SshKbdInteractiveAuthentication
	}
	if newKeywords.SshPreferredAuthentications != nil {
		outKeywords.SshPreferredAuthentications = newKeywords.SshPreferredAuthentications
	}
	if newKeywords.SshAddKeysToAgent != nil {
		outKeywords.SshAddKeysToAgent = newKeywords.SshAddKeysToAgent
	}
	if newKeywords.SshIdentityAgent != nil {
		outKeywords.SshIdentityAgent = newKeywords.SshIdentityAgent
	}
	if newKeywords.SshIdentitiesOnly != nil {
		outKeywords.SshIdentitiesOnly = newKeywords.SshIdentitiesOnly
	}
	if newKeywords.SshProxyJump != nil {
		outKeywords.SshProxyJump = newKeywords.SshProxyJump
	}
	if newKeywords.SshUserKnownHostsFile != nil {
		outKeywords.SshUserKnownHostsFile = newKeywords.SshUserKnownHostsFile
	}
	if newKeywords.SshGlobalKnownHostsFile != nil {
		outKeywords.SshGlobalKnownHostsFile = newKeywords.SshGlobalKnownHostsFile
	}
	if newKeywords.SshPasswordSecretName != nil {
		outKeywords.SshPasswordSecretName = newKeywords.SshPasswordSecretName
	}

	return &outKeywords
}
