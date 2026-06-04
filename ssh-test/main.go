package main

import (
	"fmt"
	"golang.org/x/crypto/ssh"
	"os"
)

func main() {
	key, err := os.ReadFile(os.ExpandEnv("$USERPROFILE/.ssh/id_ed25519_test"))
	if err != nil {
		fmt.Printf("Error reading key: %v\n", err)
		os.Exit(1)
	}
	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		fmt.Printf("Error parsing key: %v\n", err)
		os.Exit(1)
	}
	config := &ssh.ClientConfig{
		User: "root",
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}
	client, err := ssh.Dial("tcp", "127.0.0.1:2222", config)
	if err != nil {
		fmt.Printf("Error dialing: %v\n", err)
		os.Exit(1)
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		fmt.Printf("Error creating session: %v\n", err)
		os.Exit(1)
	}
	defer session.Close()
	output, err := session.CombinedOutput("echo SSH_OK; hostname")
	if err != nil {
		fmt.Printf("Error running command: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Output: %s\n", string(output))
}
