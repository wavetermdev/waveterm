// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wsl

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func DetectShell(ctx context.Context, client *Distro) (string, error) {
	wshPath := GetWshPath(ctx, client)

	cmd := client.WslCommand(ctx, wshPath+" shell")
	log.Printf("shell detecting using command: %s shell", wshPath)
	out, err := cmd.Output()
	if err != nil {
		log.Printf("unable to determine shell. defaulting to /bin/bash: %s", err)
		return "/bin/bash", nil
	}
	log.Printf("detecting shell: %s", out)

	// quoting breaks this particular case
	return strings.TrimSpace(string(out)), nil
}

func GetWshVersion(ctx context.Context, client *Distro) (string, error) {
	wshPath := GetWshPath(ctx, client)

	cmd := client.WslCommand(ctx, wshPath+" version")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(out)), nil
}

func GetWshPath(ctx context.Context, client *Distro) string {
	defaultPath := wavebase.RemoteFullWshBinPath

	cmd := client.WslCommand(ctx, "which wsh")
	out, whichErr := cmd.Output()
	if whichErr == nil {
		return strings.TrimSpace(string(out))
	}

	cmd = client.WslCommand(ctx, "where.exe wsh")
	out, whereErr := cmd.Output()
	if whereErr == nil {
		return strings.TrimSpace(string(out))
	}

	// no custom install, use default path
	return defaultPath
}

func hasBashInstalled(ctx context.Context, client *Distro) (bool, error) {
	cmd := client.WslCommand(ctx, "which bash")
	out, whichErr := cmd.Output()
	if whichErr == nil && len(out) != 0 {
		return true, nil
	}

	cmd = client.WslCommand(ctx, "where.exe bash")
	out, whereErr := cmd.Output()
	if whereErr == nil && len(out) != 0 {
		return true, nil
	}

	// note: we could also check in /bin/bash explicitly
	// just in case that wasn't added to the path. but if
	// that's true, we will most likely have worse
	// problems going forward

	return false, nil
}

func GetClientOs(ctx context.Context, client *Distro) (string, error) {
	cmd := client.WslCommand(ctx, "uname -s")
	out, unixErr := cmd.CombinedOutput()
	if unixErr == nil {
		formatted := strings.ToLower(string(out))
		formatted = strings.TrimSpace(formatted)
		return formatted, nil
	}

	cmd = client.WslCommand(ctx, "echo %OS%")
	out, cmdErr := cmd.Output()
	if cmdErr == nil && strings.TrimSpace(string(out)) != "%OS%" {
		formatted := strings.ToLower(string(out))
		formatted = strings.TrimSpace(formatted)
		return strings.Split(formatted, "_")[0], nil
	}

	cmd = client.WslCommand(ctx, "echo $env:OS")
	out, psErr := cmd.Output()
	if psErr == nil && strings.TrimSpace(string(out)) != "$env:OS" {
		formatted := strings.ToLower(string(out))
		formatted = strings.TrimSpace(formatted)
		return strings.Split(formatted, "_")[0], nil
	}
	return "", fmt.Errorf("unable to determine os: {unix: %s, cmd: %s, powershell: %s}", unixErr, cmdErr, psErr)
}

func GetClientArch(ctx context.Context, client *Distro) (string, error) {
	cmd := client.WslCommand(ctx, "uname -m")
	out, unixErr := cmd.Output()
	if unixErr == nil {
		return utilfn.FilterValidArch(string(out))
	}

	cmd = client.WslCommand(ctx, "echo %PROCESSOR_ARCHITECTURE%")
	out, cmdErr := cmd.CombinedOutput()
	if cmdErr == nil && strings.TrimSpace(string(out)) != "%PROCESSOR_ARCHITECTURE%" {
		return utilfn.FilterValidArch(string(out))
	}

	cmd = client.WslCommand(ctx, "echo $env:PROCESSOR_ARCHITECTURE")
	out, psErr := cmd.CombinedOutput()
	if psErr == nil && strings.TrimSpace(string(out)) != "$env:PROCESSOR_ARCHITECTURE" {
		return utilfn.FilterValidArch(string(out))
	}
	return "", fmt.Errorf("unable to determine architecture: {unix: %s, cmd: %s, powershell: %s}", unixErr, cmdErr, psErr)
}

type CancellableCmd struct {
	Cmd    *WslCmd
	Cancel func()
}

var installTemplatesRawBash = map[string]string{
	"mkdir": `bash -c 'mkdir -p {{.installDir}}'`,
	"cat":   `bash -c 'cat > {{.tempPath}}'`,
	"mv":    `bash -c 'mv {{.tempPath}} {{.installPath}}'`,
	"chmod": `bash -c 'chmod a+x {{.installPath}}'`,
}

var installTemplatesRawDefault = map[string]string{
	"mkdir": `mkdir -p {{.installDir}}`,
	"cat":   `cat > {{.tempPath}}`,
	"mv":    `mv {{.tempPath}} {{.installPath}}`,
	"chmod": `chmod a+x {{.installPath}}`,
}

func makeCancellableCommand(ctx context.Context, client *Distro, cmdTemplateRaw string, words map[string]string) (*CancellableCmd, error) {
	cmdContext, cmdCancel := context.WithCancel(ctx)

	cmdStr := &bytes.Buffer{}
	cmdTemplate, err := template.New("").Parse(cmdTemplateRaw)
	if err != nil {
		cmdCancel()
		return nil, err
	}
	cmdTemplate.Execute(cmdStr, words)

	cmd := client.WslCommand(cmdContext, cmdStr.String())
	return &CancellableCmd{cmd, cmdCancel}, nil
}

func CpHostToRemote(ctx context.Context, client *Distro, sourcePath string, destPath string) error {
	// warning: does not work on windows remote yet
	bashInstalled, err := hasBashInstalled(ctx, client)
	if err != nil {
		return err
	}

	var selectedTemplatesRaw map[string]string
	if bashInstalled {
		selectedTemplatesRaw = installTemplatesRawBash
	} else {
		log.Printf("bash is not installed on remote. attempting with default shell")
		selectedTemplatesRaw = installTemplatesRawDefault
	}

	// I need to use toSlash here to force unix keybindings
	// this means we can't guarantee it will work on a remote windows machine
	var installWords = map[string]string{
		"installDir":  filepath.ToSlash(filepath.Dir(destPath)),
		"tempPath":    destPath + ".temp",
		"installPath": destPath,
	}

	installStepCmds := make(map[string]*CancellableCmd)
	for cmdName, selectedTemplateRaw := range selectedTemplatesRaw {
		cancellableCmd, err := makeCancellableCommand(ctx, client, selectedTemplateRaw, installWords)
		if err != nil {
			return err
		}
		installStepCmds[cmdName] = cancellableCmd
	}

	_, err = installStepCmds["mkdir"].Cmd.Output()
	if err != nil {
		return err
	}

	// the cat part of this is complicated since it requires stdin
	catCmd := installStepCmds["cat"].Cmd
	catStdin, err := catCmd.StdinPipe()
	if err != nil {
		return err
	}
	err = catCmd.Start()
	if err != nil {
		return err
	}
	input, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("cannot open local file %s to send to host: %v", sourcePath, err)
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("wslutil:cpHostToRemote:catStdin", recover())
		}()
		io.Copy(catStdin, input)
		installStepCmds["cat"].Cancel()

		// backup just in case something weird happens
		// could cause potential race condition, but very
		// unlikely
		time.Sleep(time.Second * 1)
		process := catCmd.GetProcess()
		if process != nil {
			process.Kill()
		}
	}()
	catErr := catCmd.Wait()
	if catErr != nil && !errors.Is(catErr, context.Canceled) {
		return catErr
	}

	_, err = installStepCmds["mv"].Cmd.Output()
	if err != nil {
		return err
	}

	_, err = installStepCmds["chmod"].Cmd.Output()
	if err != nil {
		return err
	}

	return nil
}

func InstallClientRcFiles(ctx context.Context, client *Distro) error {
	path := GetWshPath(ctx, client)
	log.Printf("path to wsh searched is: %s", path)

	cmd := client.WslCommand(ctx, path+" rcfiles")
	_, err := cmd.Output()
	return err
}

func GetHomeDir(ctx context.Context, client *Distro) string {
	// note: also works for powershell
	cmd := client.WslCommand(ctx, `echo "$HOME"`)
	out, err := cmd.Output()
	if err == nil {
		return strings.TrimSpace(string(out))
	}

	cmd = client.WslCommand(ctx, `echo %userprofile%`)
	out, err = cmd.Output()
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
