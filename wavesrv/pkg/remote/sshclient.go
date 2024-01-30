// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"errors"
	"fmt"
	"log"
	"os"
	"os/user"
	"strconv"
	"strings"

	"github.com/kevinburke/ssh_config"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
	"golang.org/x/crypto/ssh"
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
	request := &sstore.UserInputRequestType{
		ResponseType: "text",
		QueryText:    "unused",
	}
	response, _ := sstore.MainBus.GetUserInput(request)
	log.Printf("response: %s\n", response.Text)

	hostKeyCallback := ssh.InsecureIgnoreHostKey()
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
