// Copyright 2023-2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"log"
	"net"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/kevinburke/ssh_config"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/feupdate"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/userinput"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type UserInputCancelError struct {
	Err error
}

func (uice UserInputCancelError) Error() string {
	return uice.Err.Error()
}

func createPublicKeyAuth(identityFile string, passphrase string) (ssh.Signer, error) {
	privateKey, err := os.ReadFile(base.ExpandHomeDir(identityFile))
	if err != nil {
		return nil, fmt.Errorf("failed to read ssh key file. err: %+v", err)
	}
	signer, err := ssh.ParsePrivateKey(privateKey)
	if err == nil {
		return signer, err
	}
	if _, ok := err.(*ssh.PassphraseMissingError); !ok {
		return nil, fmt.Errorf("failed to parse private ssh key. err: %+v", err)
	}

	signer, err = ssh.ParsePrivateKeyWithPassphrase(privateKey, []byte(passphrase))
	if err == nil {
		return signer, err
	}
	if err != x509.IncorrectPasswordError && err.Error() != "bcrypt_pbkdf: empty password" {
		log.Printf("qwerty: %+v", err)
		return nil, fmt.Errorf("failed to parse private ssh key. err: %+v", err)
	}
	request := &userinput.UserInputRequestType{
		ResponseType: "text",
		QueryText:    fmt.Sprintf("Enter passphrase for the SSH key: %s", identityFile),
		Title:        "Publickey Auth + Passphrase",
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelFn()
	response, err := userinput.MainBus.GetUserInput(ctx, request)
	if err != nil {
		return nil, UserInputCancelError{Err: err}
	}
	return ssh.ParsePrivateKeyWithPassphrase(privateKey, []byte(response.Text))
}

func createDefaultPasswordCallbackPrompt(password string) func() (secret string, err error) {
	return func() (secret string, err error) {
		// this should be modified to return an error if no password is stored
		// but an empty password is not sufficient because some systems allow
		// empty passwords
		return password, nil
	}
}

func createInteractivePasswordCallbackPrompt() func() (secret string, err error) {
	return func() (secret string, err error) {
		// limited to 15 seconds for some reason. this should be investigated more
		// in the future
		ctx, cancelFn := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancelFn()
		request := &userinput.UserInputRequestType{
			ResponseType: "text",
			QueryText:    "Password:",
			Title:        "Password Authentication",
		}
		response, err := userinput.MainBus.GetUserInput(ctx, request)
		if err != nil {
			return "", err
		}
		return response.Text, nil
	}
}

func createCombinedPasswordCallbackPrompt(password string) func() (secret string, err error) {
	var once sync.Once
	return func() (secret string, err error) {
		var prompt func() (secret string, err error)
		once.Do(func() { prompt = createDefaultPasswordCallbackPrompt(password) })
		if prompt == nil {
			prompt = createInteractivePasswordCallbackPrompt()
		}
		return prompt()
	}
}

func createNaiveKbdInteractiveChallenge(password string) func(name, instruction string, questions []string, echos []bool) (answers []string, err error) {
	return func(name, instruction string, questions []string, echos []bool) (answers []string, err error) {
		for _, q := range questions {
			if strings.Contains(strings.ToLower(q), "password") {
				answers = append(answers, password)
			} else {
				answers = append(answers, "")
			}
		}
		return answers, nil
	}
}

func createInteractiveKbdInteractiveChallenge() func(name, instruction string, questions []string, echos []bool) (answers []string, err error) {
	return func(name, instruction string, questions []string, echos []bool) (answers []string, err error) {
		if len(questions) != len(echos) {
			return nil, fmt.Errorf("bad response from server: questions has len %d, echos has len %d", len(questions), len(echos))
		}
		for i, question := range questions {
			echo := echos[i]
			answer, err := promptChallengeQuestion(question, echo)
			if err != nil {
				return nil, err
			}
			answers = append(answers, answer)
		}
		return answers, nil
	}
}

func promptChallengeQuestion(question string, echo bool) (answer string, err error) {
	// limited to 15 seconds for some reason. this should be investigated more
	// in the future
	ctx, cancelFn := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelFn()
	request := &userinput.UserInputRequestType{
		ResponseType: "text",
		QueryText:    question,
		Title:        "Keyboard Interactive Authentication",
	}
	response, err := userinput.MainBus.GetUserInput(ctx, request)
	if err != nil {
		return "", err
	}
	return response.Text, nil
}

func createCombinedKbdInteractiveChallenge(password string) ssh.KeyboardInteractiveChallenge {
	var once sync.Once
	return func(name, instruction string, questions []string, echos []bool) (answers []string, err error) {
		var challenge ssh.KeyboardInteractiveChallenge
		once.Do(func() { challenge = createNaiveKbdInteractiveChallenge(password) })
		if challenge == nil {
			challenge = createInteractiveKbdInteractiveChallenge()
		}
		return challenge(name, instruction, questions, echos)
	}
}

func openKnownHostsForEdit(knownHostsFilename string) (*os.File, error) {
	path, _ := filepath.Split(knownHostsFilename)
	err := os.MkdirAll(path, 0700)
	if err != nil {
		return nil, err
	}
	return os.OpenFile(knownHostsFilename, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
}

func writeToKnownHosts(knownHostsFile string, newLine string, getUserVerification func() (*scpacket.UserInputResponsePacketType, error)) error {
	if getUserVerification == nil {
		getUserVerification = func() (*scpacket.UserInputResponsePacketType, error) {
			return &scpacket.UserInputResponsePacketType{
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
		return UserInputCancelError{Err: fmt.Errorf("Canceled by the user")}
	}

	_, err = f.WriteString(newLine)
	return f.Close()
}

func createUnknownKeyVerifier(knownHostsFile string, hostname string, remote string, key ssh.PublicKey) func() (*scpacket.UserInputResponsePacketType, error) {
	base64Key := base64.StdEncoding.EncodeToString(key.Marshal())
	queryText := fmt.Sprintf(
		"The authenticity of host '%s (%s)' can't be established "+
			"as it **does not exist in any checked known_hosts files**. "+
			"The host you are attempting to connect to provides this %s key:  \n"+
			"%s.\n\n"+
			"**Would you like to continue connecting?** If so, the key will be permanently "+
			"added to the file %s "+
			"to protect from future man-in-the-middle attacks.", hostname, remote, key.Type(), base64Key, knownHostsFile)
	request := &userinput.UserInputRequestType{
		ResponseType: "confirm",
		QueryText:    queryText,
		Markdown:     true,
		Title:        "Known Hosts Key Missing",
	}
	return func() (*scpacket.UserInputResponsePacketType, error) {
		ctx, cancelFn := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelFn()
		return userinput.MainBus.GetUserInput(ctx, request)
	}
}

func createMissingKnownHostsVerifier(knownHostsFile string, hostname string, remote string, key ssh.PublicKey) func() (*scpacket.UserInputResponsePacketType, error) {
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
	request := &userinput.UserInputRequestType{
		ResponseType: "confirm",
		QueryText:    queryText,
		Markdown:     true,
		Title:        "Known Hosts File Missing",
	}
	return func() (*scpacket.UserInputResponsePacketType, error) {
		ctx, cancelFn := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelFn()
		return userinput.MainBus.GetUserInput(ctx, request)
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

func createHostKeyCallback(opts *sstore.SSHOpts) (ssh.HostKeyCallback, error) {
	rawUserKnownHostsFiles, _ := ssh_config.GetStrict(opts.SSHHost, "UserKnownHostsFile")
	userKnownHostsFiles := strings.Fields(rawUserKnownHostsFiles) // TODO - smarter splitting escaped spaces and quotes
	rawGlobalKnownHostsFiles, _ := ssh_config.GetStrict(opts.SSHHost, "GlobalKnownHostsFile")
	globalKnownHostsFiles := strings.Fields(rawGlobalKnownHostsFiles) // TODO - smarter splitting escaped spaces and quotes
	unexpandedKnownHostsFiles := append(userKnownHostsFiles, globalKnownHostsFiles...)
	var knownHostsFiles []string
	for _, filename := range unexpandedKnownHostsFiles {
		knownHostsFiles = append(knownHostsFiles, base.ExpandHomeDir(filename))
	}

	// there are no good known hosts files
	if len(knownHostsFiles) == 0 {
		return nil, fmt.Errorf("no known_hosts files provided by ssh. defaults are overridden")
	}

	var unreadableFiles []string

	// the library we use isn't very forgiving about files that are formatted
	// incorrectly. if a problem file is found, it is removed from our list
	// and we try again
	var basicCallback ssh.HostKeyCallback
	for basicCallback == nil && len(knownHostsFiles) > 0 {
		var err error
		basicCallback, err = knownhosts.New(knownHostsFiles...)
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
				return nil, fmt.Errorf("problem file (%s) doesn't exist. this should not be possible", badFile)
			}
			knownHostsFiles = okFiles
		} else if err != nil {
			// TODO handle obscure problems if possible
			return nil, fmt.Errorf("known_hosts formatting error: %+v", err)
		}
	}

	waveHostKeyCallback := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := basicCallback(hostname, remote, key)
		if err == nil {
			// success
			return nil
		} else if _, ok := err.(*knownhosts.RevokedError); ok {
			// revoked credentials are refused outright
			return err
		} else if _, ok := err.(*knownhosts.KeyError); !ok {
			// this is an unknown error (note the !ok is opposite of usual)
			return err
		}
		serr, _ := err.(*knownhosts.KeyError)
		if len(serr.Want) == 0 {
			// the key was not found

			// try to write to a file that could be parsed
			var err error
			for _, filename := range knownHostsFiles {
				newLine := knownhosts.Line([]string{knownhosts.Normalize(hostname)}, key)
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
					newLine := knownhosts.Line([]string{knownhosts.Normalize(hostname)}, key)
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
				return err
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
			alertText := fmt.Sprintf("**WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!**\n\n"+
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
			update := &feupdate.ModelUpdate{}
			update.AddUpdate(sstore.AlertMessageType{
				Markdown: true,
				Title:    "Known Hosts Key Changed",
				Message:  alertText,
			})
			feupdate.MainBus.SendUpdate(update)
			return fmt.Errorf("remote host identification has changed")
		}

		updatedCallback, err := knownhosts.New(knownHostsFiles...)
		if err != nil {
			return err
		}
		// try one final time
		return updatedCallback(hostname, remote, key)
	}

	return waveHostKeyCallback, nil
}

func ConnectToClient(opts *sstore.SSHOpts) (*ssh.Client, error) {
	ssh_config.ReloadConfigs()
	configIdentity, _ := ssh_config.GetStrict(opts.SSHHost, "IdentityFile")
	var identityFile string
	if opts.SSHIdentity != "" {
		identityFile = opts.SSHIdentity
	} else {
		identityFile = configIdentity
	}

	hostKeyCallback, err := createHostKeyCallback(opts)
	if err != nil {
		return nil, err
	}
	var authMethods []ssh.AuthMethod
	publicKeySigner, err := createPublicKeyAuth(identityFile, opts.SSHPassword)
	if err == nil {
		authMethods = append(authMethods, ssh.PublicKeys(publicKeySigner))
	}
	authMethods = append(authMethods, ssh.RetryableAuthMethod(ssh.KeyboardInteractive(createCombinedKbdInteractiveChallenge(opts.SSHPassword)), 2))
	authMethods = append(authMethods, ssh.RetryableAuthMethod(ssh.PasswordCallback(createCombinedPasswordCallbackPrompt(opts.SSHPassword)), 2))

	configUser, _ := ssh_config.GetStrict(opts.SSHHost, "User")
	configHostName, _ := ssh_config.GetStrict(opts.SSHHost, "HostName")
	configPort, _ := ssh_config.GetStrict(opts.SSHHost, "Port")
	var username string
	if opts.SSHUser != "" {
		username = opts.SSHUser
	} else if configUser != "" {
		username = configUser
	} else {
		user, err := user.Current()
		if err != nil {
			return nil, fmt.Errorf("failed to get user for ssh: %+v", err)
		}
		username = user.Username
	}
	var hostName string
	if configHostName != "" {
		hostName = configHostName
	} else {
		hostName = opts.SSHHost
	}
	clientConfig := &ssh.ClientConfig{
		User:            username,
		Auth:            authMethods,
		HostKeyCallback: hostKeyCallback,
	}
	var port string
	if opts.SSHPort != 0 && opts.SSHPort != 22 {
		port = strconv.Itoa(opts.SSHPort)
	} else if configPort != "" && configPort != "22" {
		port = configPort
	} else {
		port = "22"
	}
	networkAddr := hostName + ":" + port
	return ssh.Dial("tcp", networkAddr, clientConfig)
}
