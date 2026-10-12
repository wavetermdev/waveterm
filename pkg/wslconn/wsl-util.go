// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wslconn

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wsl"
)

func hasBashInstalled(ctx context.Context, client *wsl.Distro) (bool, error) {
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

func normalizeOs(os string) string {
	os = strings.ToLower(strings.TrimSpace(os))
	return os
}

func normalizeArch(arch string) string {
	arch = strings.ToLower(strings.TrimSpace(arch))
	switch arch {
	case "x86_64", "amd64":
		arch = "x64"
	case "arm64", "aarch64":
		arch = "arm64"
	}
	return arch
}

// returns (os, arch, error)
// guaranteed to return a supported platform
func GetClientPlatform(ctx context.Context, shell genconn.ShellClient) (string, string, error) {
	blocklogger.Infof(ctx, "[conndebug] running `uname -sm` to detect client platform\n")
	stdout, stderr, err := genconn.RunSimpleCommand(ctx, shell, genconn.CommandSpec{
		Cmd: "uname -sm",
	})
	if err != nil {
		return "", "", fmt.Errorf("error running uname -sm: %w, stderr: %s", err, stderr)
	}
	// Parse and normalize output
	parts := strings.Fields(strings.ToLower(strings.TrimSpace(stdout)))
	if len(parts) != 2 {
		return "", "", fmt.Errorf("unexpected output from uname: %s", stdout)
	}
	os, arch := normalizeOs(parts[0]), normalizeArch(parts[1])
	if err := wavebase.ValidateWshSupportedArch(os, arch); err != nil {
		return "", "", err
	}
	return os, arch, nil
}

func GetClientPlatformFromOsArchStr(ctx context.Context, osArchStr string) (string, string, error) {
	parts := strings.Fields(strings.TrimSpace(osArchStr))
	if len(parts) != 2 {
		return "", "", fmt.Errorf("unexpected output from uname: %s", osArchStr)
	}
	os, arch := normalizeOs(parts[0]), normalizeArch(parts[1])
	if err := wavebase.ValidateWshSupportedArch(os, arch); err != nil {
		return "", "", err
	}
	return os, arch, nil
}

type CancellableCmd struct {
	Cmd    *wsl.WslCmd
	Cancel func()
}

var installTemplatesRawBash = map[string]string{
	"mkdir": `bash -c 'mkdir -p {{.installDir}}'`,
	"cat":   `bash -c 'cat > {{.tempPath}}'`,
	"mv":    `bash -c 'mv {{.tempPath}} {{.installPath}}'`,
	"chmod": `bash -c 'chmod a+x {{.installPath}}'`,
	"cp":    `bash -c 'cp {{.installPath}} {{.wavePath}}'`,
}

var installTemplatesRawDefault = map[string]string{
	"mkdir": `mkdir -p {{.installDir}}`,
	"cat":   `cat > {{.tempPath}}`,
	"mv":    `mv {{.tempPath}} {{.installPath}}`,
	"chmod": `chmod a+x {{.installPath}}`,
	"cp":    `cp {{.installPath}} {{.wavePath}}`,
}

func makeCancellableCommand(ctx context.Context, client *wsl.Distro, cmdTemplateRaw string, words map[string]string) (*CancellableCmd, error) {
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

func CpWshToRemote(ctx context.Context, client *wsl.Distro, clientOs string, clientArch string) error {
	wshLocalPath, err := shellutil.GetLocalWshBinaryPath(wavebase.WaveVersion, clientOs, clientArch)
	if err != nil {
		return err
	}
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
		"installDir":  filepath.ToSlash(filepath.Dir(wavebase.RemoteFullWshBinPath)),
		"tempPath":    wavebase.RemoteFullWshBinPath + ".temp",
		"installPath": wavebase.RemoteFullWshBinPath,
		"wavePath":    wavebase.RemoteFullWaveBinPath,
	}

	blocklogger.Infof(ctx, "[conndebug] copying %q to remote server %q\n", wshLocalPath, wavebase.RemoteFullWshBinPath)
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
	input, err := os.Open(wshLocalPath)
	if err != nil {
		return fmt.Errorf("cannot open local file %s to send to host: %v", wshLocalPath, err)
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

	_, err = installStepCmds["cp"].Cmd.Output()
	if err != nil {
		return err
	}

	return nil
}

func IsPowershell(shellPath string) bool {
	// get the base path, and then check contains
	shellBase := filepath.Base(shellPath)
	return strings.Contains(shellBase, "powershell") || strings.Contains(shellBase, "pwsh")
}
