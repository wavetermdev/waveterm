// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"os/user"
	"strconv"
	"strings"
	"time"

	"github.com/kevinburke/ssh_config"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

func createPublicKeyAuth(identityFile string, passphrase string) (ssh.AuthMethod, error) {
	privateKey, err := os.ReadFile(base.ExpandHomeDir(identityFile))
	if err != nil {
		return nil, fmt.Errorf("failed to read ssh key file. err: %+v", err)
	}
	signer, err := ssh.ParsePrivateKey(privateKey)
	if err != nil {
		if errors.Is(err, &ssh.PassphraseMissingError{}) {
			signer, err = ssh.ParsePrivateKeyWithPassphrase(privateKey, []byte(passphrase))
			if err != nil {
				return nil, fmt.Errorf("failed to parse private ssh key with passphrase. err: %+v", err)
			}
		} else {
			return nil, fmt.Errorf("failed to parse private ssh key. err: %+v", err)
		}
	}
	return ssh.PublicKeys(signer), nil
}

func createKeyboardInteractiveAuth(password string) ssh.AuthMethod {
	challenge := func(name, instruction string, questions []string, echos []bool) (answers []string, err error) {
		for _, q := range questions {
			if strings.Contains(strings.ToLower(q), "password") {
				answers = append(answers, password)
			} else {
				answers = append(answers, "")
			}
		}
		return answers, nil
	}
	return ssh.KeyboardInteractive(challenge)
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
	var unfilteredKnownHostsFiles []string
	copy(unfilteredKnownHostsFiles, knownHostsFiles)

	// the library we use isn't very forgiving about files that are formatted
	// incorrectly. if a problem file is found, it is removed from our list
	// and we try again
	var basicCallback ssh.HostKeyCallback
	for basicCallback == nil && len(knownHostsFiles) > 0 {
		var err error
		basicCallback, err = knownhosts.New(knownHostsFiles...)
		if serr, ok := err.(*os.PathError); ok {
			badFile := serr.Path
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

	// determine which file is writeable in case the key is not found.
	// use knownHostsFiles because there is no point reading to a file
	// that we can't parse
	var writeableKnownHostsFile string
	for _, filename := range knownHostsFiles {
		f, err := os.OpenFile(filename, os.O_APPEND|os.O_WRONLY, 0644)
		if err == nil {
			f.Close()
			writeableKnownHostsFile = filename
			break
		}
	}

	if len(knownHostsFiles) == 0 {
		// TODO attempt to create a known host file
		return nil, fmt.Errorf("there are no known_host files that can be opened")
	}

	waveHostKeyCallback := func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := basicCallback(hostname, remote, key)
		if err == nil {
			// success
			return nil
		} else if _, ok := err.(*knownhosts.RevokedError); ok {
			// revoked credentials are refused outright
			return fmt.Errorf("foo")
		} else if _, ok := err.(*knownhosts.KeyError); !ok {
			// this is an unknown error
			return fmt.Errorf("bar")
		}
		serr, _ := err.(*knownhosts.KeyError)
		var request *sstore.UserInputRequestType
		ctx, cancelFn := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelFn()
		if writeableKnownHostsFile == "" {
			if len(unfilteredKnownHostsFiles) == 0 {
				return fmt.Errorf("no known_hosts files provided")
			}
			knownHostsFileToCreate := unfilteredKnownHostsFiles[0]
			request = &sstore.UserInputRequestType{
				ResponseType: "confirm",
				QueryText: fmt.Sprintf("You do not have appear to have a known_hosts file in any of\n\n"+
					"the expected locations. Would you like to create %s and add the key for %s (%s) to it?",
					knownHostsFileToCreate, hostname, remote.String()),
				Markdown: true,
				Title:    "Known Hosts Key Missing",
			}

		} else if len(serr.Want) == 0 {
			request = &sstore.UserInputRequestType{
				ResponseType: "confirm",
				QueryText: fmt.Sprintf("The authenticity of host '%s (%s)' can't be established.\n\n"+
					"%s key fingerprint is %s.\n\nThe key is not known by any other names.\n\nAre you sure"+
					"you want to continue connecting?", hostname, remote.String(), key.Type(), "TODO"),
				Markdown: true,
				Title:    "Known Hosts Key Missing",
			}
		} else {
			request = &sstore.UserInputRequestType{
				ResponseType: "confirm",
				QueryText: fmt.Sprintf("The key provided does not match the one stored in your known\n\n" +
					"hosts file. If this is unexpected, it could indicate a man-in-the-middle attack. Are\n\n" +
					"you sure you want to continue connecting?"),
				Markdown: true,
				Title:    "Known Hosts Key Mismatch",
			}
		}
		response, err := sstore.MainBus.GetUserInput(request, ctx)
		if err != nil {
			return err
		}
		if !response.Confirm {
			return fmt.Errorf("canceled by the user")
		}
		// attempt to fix the problem

		// try one final time
		return basicCallback(hostname, remote, key)
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

	// test code
	ctx, cancelFn := context.WithTimeout(context.Background(), 1000*time.Second)
	defer cancelFn()
	request := &sstore.UserInputRequestType{
		ResponseType: "text",
		QueryText:    "this is a question",
		Title:        "testing",
		Markdown:     false,
	}
	response, err := sstore.MainBus.GetUserInput(request, ctx)
	if err != nil {
		return nil, err
	}
	log.Printf("response: %s\n", response.Text)

	hostKeyCallback, err := createHostKeyCallback(opts)
	if err != nil {
		return nil, fmt.Errorf("uh oh host key: %+v", err)
	}
	var authMethods []ssh.AuthMethod
	publicKeyAuth, err := createPublicKeyAuth(identityFile, opts.SSHPassword)
	if err == nil {
		authMethods = append(authMethods, publicKeyAuth)
	}
	authMethods = append(authMethods, createKeyboardInteractiveAuth(opts.SSHPassword))
	authMethods = append(authMethods, ssh.Password(opts.SSHPassword))

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
