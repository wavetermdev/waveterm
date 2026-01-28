// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/colprint"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"golang.org/x/term"
)

const (
	MaxFileSize = 10 * 1024 * 1024 // 10MB

	TimeoutYear = int64(365) * 24 * 60 * 60 * 1000

	UriHelpText = `

URI format: [profile]:[uri-scheme]://[connection]/[path]

Supported URI schemes:
  wsh:
    Used to access files on remote hosts over SSH via the WSH helper. Allows
    for file streaming to Wave and other remotes.

    Profiles are optional for WSH URIs, provided that you have configured the
    remote host in your "connections.json" or "~/.ssh/config" file.

    If a profile is provided, it must be defined in "profiles.json" in the Wave
    configuration directory.

    Format: wsh://[remote]/[path]

    Shorthands can be used for the current remote and your local computer:
      [path]              a relative or absolute path on the current remote
      //[remote]/[path]   a path on a remote
      /~/[path]           a path relative to the home directory on your local
                          computer`
)

var fileCmd = &cobra.Command{
	Use:   "file",
	Short: "manage files across different storage systems",
	Long: `Manage files across different storage systems.
    
Wave Terminal is capable of managing files from remote SSH hosts, S3-compatible
systems, and the internal Wave filesystem. Files are addressed via URIs, which
vary depending on the storage system.` + UriHelpText}

var fileTimeout int64

func init() {
	rootCmd.AddCommand(fileCmd)

	fileCmd.PersistentFlags().Int64VarP(&fileTimeout, "timeout", "t", 15000, "timeout in milliseconds for long operations")

	fileListCmd.Flags().BoolP("long", "l", false, "use long listing format")
	fileListCmd.Flags().BoolP("one", "1", false, "list one file per line")
	fileListCmd.Flags().BoolP("files", "f", false, "list files only")

	fileCmd.AddCommand(fileListCmd)
	fileCmd.AddCommand(fileCatCmd)
	fileCmd.AddCommand(fileWriteCmd)
	fileRmCmd.Flags().BoolP("recursive", "r", false, "remove directories recursively")
	fileCmd.AddCommand(fileRmCmd)
	fileCmd.AddCommand(fileInfoCmd)
	fileCmd.AddCommand(fileAppendCmd)
	fileCpCmd.Flags().BoolP("merge", "m", false, "merge directories")
	fileCpCmd.Flags().BoolP("force", "f", false, "force overwrite of existing files")
	fileCmd.AddCommand(fileCpCmd)
	fileMvCmd.Flags().BoolP("force", "f", false, "force overwrite of existing files")
	fileCmd.AddCommand(fileMvCmd)
}

var fileListCmd = &cobra.Command{
	Use:     "ls [uri]",
	Aliases: []string{"list"},
	Short:   "list files",
	Long:    "List files in a directory. By default, lists files in the current directory." + UriHelpText,
	Example: "  wsh file ls wsh://user@ec2/home/user/",
	RunE:    activityWrap("file", fileListRun),
	PreRunE: preRunSetupRpcClient,
}

var fileCatCmd = &cobra.Command{
	Use:     "cat [uri]",
	Short:   "display contents of a file",
	Long:    "Display the contents of a file." + UriHelpText,
	Example: "  wsh file cat wsh://user@ec2/home/user/config.txt",
	Args:    cobra.ExactArgs(1),
	RunE:    activityWrap("file", fileCatRun),
	PreRunE: preRunSetupRpcClient,
}

var fileInfoCmd = &cobra.Command{
	Use:     "info [uri]",
	Short:   "show wave file information",
	Long:    "Show information about a file." + UriHelpText,
	Example: "  wsh file info wsh://user@ec2/home/user/config.txt",
	Args:    cobra.ExactArgs(1),
	RunE:    activityWrap("file", fileInfoRun),
	PreRunE: preRunSetupRpcClient,
}

var fileRmCmd = &cobra.Command{
	Use:     "rm [uri]",
	Short:   "remove a file",
	Long:    "Remove a file." + UriHelpText,
	Example: "  wsh file rm wsh://user@ec2/home/user/config.txt",
	Args:    cobra.ExactArgs(1),
	RunE:    activityWrap("file", fileRmRun),
	PreRunE: preRunSetupRpcClient,
}

var fileWriteCmd = &cobra.Command{
	Use:     "write [uri]",
	Short:   "write stdin into a file (up to 10MB)",
	Long:    "Write stdin into a file, buffering input (10MB total file size limit)." + UriHelpText,
	Example: "  echo 'hello' | wsh file write ./greeting.txt",
	Args:    cobra.ExactArgs(1),
	RunE:    activityWrap("file", fileWriteRun),
	PreRunE: preRunSetupRpcClient,
}

var fileAppendCmd = &cobra.Command{
	Use:     "append [uri]",
	Short:   "append stdin to a file",
	Long:    "Append stdin to a file, buffering input (10MB total file size limit)." + UriHelpText,
	Example: "  tail -f log.txt | wsh file append ./app.log",
	Args:    cobra.ExactArgs(1),
	RunE:    activityWrap("file", fileAppendRun),
	PreRunE: preRunSetupRpcClient,
}

var fileCpCmd = &cobra.Command{
	Use:     "cp [source-uri] [destination-uri]" + UriHelpText,
	Aliases: []string{"copy"},
	Short:   "copy files between storage systems, recursively if needed",
	Long:    "Copy files between different storage systems." + UriHelpText,
	Example: "  wsh file cp wsh://user@ec2/home/user/config.txt ./local-config.txt\n  wsh file cp ./local-config.txt wsh://user@ec2/home/user/config.txt",
	Args:    cobra.ExactArgs(2),
	RunE:    activityWrap("file", fileCpRun),
	PreRunE: preRunSetupRpcClient,
}

var fileMvCmd = &cobra.Command{
	Use:     "mv [source-uri] [destination-uri]" + UriHelpText,
	Aliases: []string{"move"},
	Short:   "move files between storage systems",
	Long:    "Move files between different storage systems. The source file will be deleted once the operation completes successfully." + UriHelpText,
	Example: "  wsh file mv wsh://user@ec2/home/user/config.txt ./local-config.txt\n  wsh file mv ./local-config.txt wsh://user@ec2/home/user/config.txt",
	Args:    cobra.ExactArgs(2),
	RunE:    activityWrap("file", fileMvRun),
	PreRunE: preRunSetupRpcClient,
}

func fileCatRun(cmd *cobra.Command, args []string) error {
	path, err := fixRelativePaths(args[0])
	if err != nil {
		return err
	}

	_, err = checkFileSize(path, MaxFileSize)
	if err != nil {
		return err
	}

	fileData := wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: path}}

	err = streamReadFromFile(cmd.Context(), fileData, os.Stdout)
	if err != nil {
		return fmt.Errorf("reading file: %w", err)
	}

	return nil
}

func fileInfoRun(cmd *cobra.Command, args []string) error {
	path, err := fixRelativePaths(args[0])
	if err != nil {
		return err
	}
	fileData := wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: path}}

	info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
	err = convertNotFoundErr(err)
	if err != nil {
		return fmt.Errorf("getting file info: %w", err)
	}

	if info.NotFound {
		return fmt.Errorf("%s: no such file", path)
	}

	WriteStdout("name:\t%s\n", info.Name)
	if info.Mode != 0 {
		WriteStdout("mode:\t%s\n", info.Mode.String())
	}
	WriteStdout("mtime:\t%s\n", time.Unix(info.ModTime/1000, 0).Format(time.DateTime))
	if !info.IsDir {
		WriteStdout("size:\t%d\n", info.Size)
	}
	if info.Meta != nil && len(*info.Meta) > 0 {
		WriteStdout("metadata:\n")
		for k, v := range *info.Meta {
			WriteStdout("\t\t\t%s: %v\n", k, v)
		}
	}
	return nil
}

func fileRmRun(cmd *cobra.Command, args []string) error {
	path, err := fixRelativePaths(args[0])
	if err != nil {
		return err
	}
	recursive, err := cmd.Flags().GetBool("recursive")
	if err != nil {
		return err
	}

	err = wshclient.FileDeleteCommand(RpcClient, wshrpc.CommandDeleteFileData{Path: path, Recursive: recursive}, &wshrpc.RpcOpts{Timeout: fileTimeout})
	if err != nil {
		return fmt.Errorf("removing file: %w", err)
	}

	return nil
}

func fileWriteRun(cmd *cobra.Command, args []string) error {
	path, err := fixRelativePaths(args[0])
	if err != nil {
		return err
	}
	fileData := wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: path}}

	buf := make([]byte, MaxFileSize)
	n, err := WrappedStdin.Read(buf)
	if err != nil && err != io.EOF {
		return fmt.Errorf("reading input: %w", err)
	}
	if int64(n) == MaxFileSize {
		if _, err := WrappedStdin.Read(make([]byte, 1)); err != io.EOF {
			return fmt.Errorf("input exceeds maximum file size of %d bytes", MaxFileSize)
		}
	}
	fileData.Data64 = base64.StdEncoding.EncodeToString(buf[:n])
	err = wshclient.FileWriteCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
	if err != nil {
		return fmt.Errorf("writing file: %w", err)
	}

	return nil
}

func fileAppendRun(cmd *cobra.Command, args []string) error {
	path, err := fixRelativePaths(args[0])
	if err != nil {
		return err
	}
	fileData := wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: path}}

	info, err := ensureFile(fileData)
	if err != nil {
		return err
	}
	if info.Size >= MaxFileSize {
		return fmt.Errorf("file already at maximum size (%d bytes)", MaxFileSize)
	}

	reader := bufio.NewReader(WrappedStdin)
	var buf bytes.Buffer
	remainingSpace := MaxFileSize - info.Size
	for {
		chunk := make([]byte, 8192)
		n, err := reader.Read(chunk)
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("reading input: %w", err)
		}

		if int64(buf.Len()+n) > remainingSpace {
			return fmt.Errorf("append would exceed maximum file size of %d bytes", MaxFileSize)
		}

		buf.Write(chunk[:n])

		if buf.Len() >= 8192 { // 8KB batch size
			fileData.Data64 = base64.StdEncoding.EncodeToString(buf.Bytes())
			err = wshclient.FileAppendCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
			if err != nil {
				return fmt.Errorf("appending to file: %w", err)
			}
			remainingSpace -= int64(buf.Len())
			buf.Reset()
		}
	}

	if buf.Len() > 0 {
		fileData.Data64 = base64.StdEncoding.EncodeToString(buf.Bytes())
		err = wshclient.FileAppendCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
		if err != nil {
			return fmt.Errorf("appending to file: %w", err)
		}
	}

	return nil
}

func checkFileSize(path string, maxSize int64) (*wshrpc.FileInfo, error) {
	fileData := wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: path}}

	info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
	err = convertNotFoundErr(err)
	if err != nil {
		return nil, fmt.Errorf("getting file info: %w", err)
	}
	if info.NotFound {
		return nil, fmt.Errorf("%s: no such file", path)
	}
	if info.IsDir {
		return nil, fmt.Errorf("%s: is a directory", path)
	}
	if info.Size > maxSize {
		return nil, fmt.Errorf("file size (%d bytes) exceeds maximum of %d bytes", info.Size, maxSize)
	}
	return info, nil
}

func getTargetPath(src, dst string) (string, error) {
	srcBase := filepath.Base(src)

	dstInfo, err := os.Stat(dst)
	if err == nil && dstInfo.IsDir() {
		// If it's an existing directory, use the source filename
		return filepath.Join(dst, srcBase), nil
	}
	if err != nil && !os.IsNotExist(err) {
		// Return error if it's something other than not exists
		return "", fmt.Errorf("checking destination path: %w", err)
	}

	return dst, nil
}

func fileCpRun(cmd *cobra.Command, args []string) error {
	src, dst := args[0], args[1]
	merge, err := cmd.Flags().GetBool("merge")
	if err != nil {
		return err
	}
	force, err := cmd.Flags().GetBool("force")
	if err != nil {
		return err
	}

	srcPath, err := fixRelativePaths(src)
	if err != nil {
		return fmt.Errorf("unable to parse src path: %w", err)
	}

	_, err = checkFileSize(srcPath, MaxFileSize)
	if err != nil {
		return err
	}

	destPath, err := fixRelativePaths(dst)
	if err != nil {
		return fmt.Errorf("unable to parse dest path: %w", err)
	}
	log.Printf("Copying %s to %s; merge: %v, force: %v", srcPath, destPath, merge, force)
	rpcOpts := &wshrpc.RpcOpts{Timeout: TimeoutYear}
	err = wshclient.FileCopyCommand(RpcClient, wshrpc.CommandFileCopyData{SrcUri: srcPath, DestUri: destPath, Opts: &wshrpc.FileCopyOpts{Merge: merge, Overwrite: force, Timeout: TimeoutYear}}, rpcOpts)
	if err != nil {
		return fmt.Errorf("copying file: %w", err)
	}
	return nil
}

func fileMvRun(cmd *cobra.Command, args []string) error {
	src, dst := args[0], args[1]
	force, err := cmd.Flags().GetBool("force")
	if err != nil {
		return err
	}

	srcPath, err := fixRelativePaths(src)
	if err != nil {
		return fmt.Errorf("unable to parse src path: %w", err)
	}

	_, err = checkFileSize(srcPath, MaxFileSize)
	if err != nil {
		return err
	}

	destPath, err := fixRelativePaths(dst)
	if err != nil {
		return fmt.Errorf("unable to parse dest path: %w", err)
	}
	log.Printf("Moving %s to %s; force: %v", srcPath, destPath, force)
	rpcOpts := &wshrpc.RpcOpts{Timeout: TimeoutYear}
	err = wshclient.FileMoveCommand(RpcClient, wshrpc.CommandFileCopyData{SrcUri: srcPath, DestUri: destPath, Opts: &wshrpc.FileCopyOpts{Overwrite: force, Timeout: TimeoutYear}}, rpcOpts)
	if err != nil {
		return fmt.Errorf("moving file: %w", err)
	}
	return nil
}

func filePrintColumns(filesChan <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]) error {
	width := 80 // default if we can't get terminal
	if w, _, err := term.GetSize(int(os.Stdout.Fd())); err == nil {
		width = w
	}

	numCols := width / 10
	if numCols < 1 {
		numCols = 1
	}

	return colprint.PrintColumnsArray(
		filesChan,
		numCols,
		100, // sample size
		func(respUnion wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]) ([]string, error) {
			if respUnion.Error != nil {
				return []string{}, respUnion.Error
			}
			strs := make([]string, len(respUnion.Response.FileInfo))
			for i, f := range respUnion.Response.FileInfo {
				strs[i] = f.Name
			}
			return strs, nil
		},
		os.Stdout,
	)
}

func filePrintLong(filesChan <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]) error {
	// Sample first 100 files to determine name width
	maxNameLen := 0
	var samples []*wshrpc.FileInfo

	for respUnion := range filesChan {
		if respUnion.Error != nil {
			return respUnion.Error
		}
		resp := respUnion.Response
		samples = append(samples, resp.FileInfo...)
	}

	// Use sampled width, but cap it at 60 chars to prevent excessive width
	nameWidth := maxNameLen + 2
	if nameWidth > 60 {
		nameWidth = 60
	}

	writer := tabwriter.NewWriter(os.Stdout, 0, 8, 1, '\t', 0)

	// Print samples
	for _, f := range samples {
		name := f.Name
		t := time.Unix(f.ModTime/1000, 0)
		timestamp := utilfn.FormatLsTime(t)
		if f.Size == 0 && strings.HasSuffix(name, "/") {
			fmt.Fprintf(writer, "%-*s\t%8s\t%s\n", nameWidth, name, "-", timestamp)
		} else {
			fmt.Fprintf(writer, "%-*s\t%8d\t%s\n", nameWidth, name, f.Size, timestamp)
		}
	}

	// Continue with remaining files
	for respUnion := range filesChan {
		if respUnion.Error != nil {
			return respUnion.Error
		}
		for _, f := range respUnion.Response.FileInfo {
			name := f.Name
			t := time.Unix(f.ModTime/1000, 0)
			timestamp := utilfn.FormatLsTime(t)
			if f.Size == 0 && strings.HasSuffix(name, "/") {
				fmt.Fprintf(writer, "%-*s\t%8s\t%s\n", nameWidth, name, "-", timestamp)
			} else {
				fmt.Fprintf(writer, "%-*s\t%8d\t%s\n", nameWidth, name, f.Size, timestamp)
			}
		}
	}
	writer.Flush()

	return nil
}

func fileListRun(cmd *cobra.Command, args []string) error {
	longForm, _ := cmd.Flags().GetBool("long")
	onePerLine, _ := cmd.Flags().GetBool("one")

	// Check if we're in a pipe
	stat, _ := os.Stdout.Stat()
	isPipe := (stat.Mode() & os.ModeCharDevice) == 0
	if isPipe {
		onePerLine = true
	}

	if len(args) == 0 {
		args = []string{"."}
	}

	path, err := fixRelativePaths(args[0])
	if err != nil {
		return err
	}

	filesChan := wshclient.FileListStreamCommand(RpcClient, wshrpc.FileListData{Path: path, Opts: &wshrpc.FileListOpts{All: false}}, &wshrpc.RpcOpts{Timeout: 2000})
	// Drain the channel when done
	defer utilfn.DrainChannelSafe(filesChan, "fileListRun")
	if longForm {
		return filePrintLong(filesChan)
	}

	if onePerLine {
		for respUnion := range filesChan {
			if respUnion.Error != nil {
				log.Printf("error: %v", respUnion.Error)
				return respUnion.Error
			}
			for _, f := range respUnion.Response.FileInfo {
				fmt.Fprintln(os.Stdout, f.Name)
			}
			return nil
		}
	}

	return filePrintColumns(filesChan)
}
