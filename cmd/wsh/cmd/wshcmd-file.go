// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/remote/connparse"
	"github.com/wavetermdev/waveterm/pkg/util/colprint"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"golang.org/x/term"
)

const (
	MaxFileSize    = 10 * 1024 * 1024 // 10MB
	WaveFileScheme = "wavefile"
	WaveFilePrefix = "wavefile://"

	DefaultFileTimeout = 5000

	UriHelpText = `

URI format: [profile]:[uri-scheme]://[connection]/[path]

Supported URI schemes:
  wavefile:
    Used to retrieve blockfiles from the internal Wave filesystem.

    Format: wsh://[zoneid]/[path]
  wsh:
    Used to access files on remotes via the WSH helper. Allows for file streaming to Wave and other remotes.
    Profiles are optional for WSH URIs, provided that you have configured the remote host in your "connections.json" or "~/.ssh/config" file.
	If a profile is provided, it must be defined in "profiles.json" in the Wave configuration directory.
	
    Format: wsh://[remote]/[path]

    Shorthands can be used for the current remote and your local machine:
      - [path] is a relative or absolute path on the current remote
      - //[remote]/[path] is a path on a remote
      - /~/[path] is a path relative to your home directory on your local machine

  s3:
    Used to access files on S3-compatible systems.
	Requires S3 credentials to be set up, either in the AWS CLI configuration files, or in "profiles.json" in the Wave configuration directory.
    If no profile is provided, the default from your AWS CLI configuration will be used. Profiles from the AWS CLI must be prefixed with "aws:".
	
    Format: s3://[bucket]/[path]
            aws:[profile]:s3://[bucket]/[path]
            [profile]:s3://[bucket]/[path]`
)

var fileCmd = &cobra.Command{
	Use:   "file",
	Short: "manage Wave Terminal files",
	Long:  "Commands to manage files across different storage systems." + UriHelpText}

var fileTimeout int

func init() {
	rootCmd.AddCommand(fileCmd)

	fileCmd.PersistentFlags().IntVarP(&fileTimeout, "timeout", "t", 15000, "timeout in milliseconds for long operations")

	fileListCmd.Flags().BoolP("recursive", "r", false, "list subdirectories recursively")
	fileListCmd.Flags().BoolP("long", "l", false, "use long listing format")
	fileListCmd.Flags().BoolP("one", "1", false, "list one file per line")
	fileListCmd.Flags().BoolP("files", "f", false, "list files only")

	fileCmd.AddCommand(fileListCmd)
	fileCmd.AddCommand(fileCatCmd)
	fileCmd.AddCommand(fileWriteCmd)
	fileCmd.AddCommand(fileRmCmd)
	fileCmd.AddCommand(fileInfoCmd)
	fileCmd.AddCommand(fileAppendCmd)
	fileCmd.AddCommand(fileCpCmd)
}

type waveFileRef struct {
	zoneId   string
	fileName string
}

func resolveWaveFile(ref *waveFileRef) (*waveobj.ORef, error) {
	return resolveSimpleId(ref.zoneId)
}

var fileListCmd = &cobra.Command{
	Use:     "ls [uri]",
	Short:   "list files",
	Long:    "List files in a directory. By default, lists files in the current directory." + UriHelpText,
	Example: "  wsh file ls wsh://user@ec2/home/user/\n  wsh file ls wavefile://client/configs/",
	RunE:    activityWrap("file", fileListRun),
	PreRunE: preRunSetupRpcClient,
}

var fileCatCmd = &cobra.Command{
	Use:     "cat [uri]",
	Short:   "display contents of a file",
	Long:    "Display the contents of a file." + UriHelpText,
	Example: "  wsh file cat wsh://user@ec2/home/user/config.txt\n  wsh file cat wavefile://client/settings.json",
	Args:    cobra.ExactArgs(1),
	RunE:    activityWrap("file", fileCatRun),
	PreRunE: preRunSetupRpcClient,
}

var fileInfoCmd = &cobra.Command{
	Use:     "info [uri]",
	Short:   "show wave file information",
	Long:    "Show information about a file." + UriHelpText,
	Example: "  wsh file info wsh://user@ec2/home/user/config.txt\n wsh file info wavefile://client/settings.json",
	Args:    cobra.ExactArgs(1),
	RunE:    activityWrap("file", fileInfoRun),
	PreRunE: preRunSetupRpcClient,
}

var fileRmCmd = &cobra.Command{
	Use:     "rm [uri]",
	Short:   "remove a file",
	Example: "  wsh file rm wsh://user@ec2/home/user/config.txt\n  wsh file rm wavefile://client/settings.json",
	Args:    cobra.ExactArgs(1),
	RunE:    activityWrap("file", fileRmRun),
	PreRunE: preRunSetupRpcClient,
}

var fileWriteCmd = &cobra.Command{
	Use:     "write [uri]",
	Short:   "write stdin into a file (up to 10MB)",
	Long:    "Write stdin into a file, buffering input and respecting 10MB total file size limit." + UriHelpText,
	Example: "  echo 'hello' | wsh file write wavefile://block/greeting.txt",
	Args:    cobra.ExactArgs(1),
	RunE:    activityWrap("file", fileWriteRun),
	PreRunE: preRunSetupRpcClient,
}

var fileAppendCmd = &cobra.Command{
	Use:     "append [uri]",
	Short:   "append stdin to a file",
	Long:    "Append stdin to a file, buffering input and respecting 10MB total file size limit" + UriHelpText,
	Example: "  tail -f log.txt | wsh file append wavefile://block/app.log",
	Args:    cobra.ExactArgs(1),
	RunE:    activityWrap("file", fileAppendRun),
	PreRunE: preRunSetupRpcClient,
}

var fileCpCmd = &cobra.Command{
	Use:     "cp [source-uri] [destination-uri]" + UriHelpText,
	Short:   "copy files between storage systems",
	Long:    "Copy files between different storage systems." + UriHelpText,
	Example: "  wsh file cp wavefile://block/config.txt ./local-config.txt\n  wsh file cp ./local-config.txt wavefile://block/config.txt\n wsh file cp wsh://user@ec2/home/user/config.txt wavefile://client/config.txt",
	Args:    cobra.ExactArgs(2),
	RunE:    activityWrap("file", fileCpRun),
	PreRunE: preRunSetupRpcClient,
}

func fileCatRun(cmd *cobra.Command, args []string) error {
	path, err := fixRelativePaths(args[0])
	if err != nil {
		return err
	}
	fileData := wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: path}}

	// Get file info first to check existence and get size
	info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
	err = convertNotFoundErr(err)
	if err == fs.ErrNotExist {
		return fmt.Errorf("%s: no such file", path)
	}
	if err != nil {
		return fmt.Errorf("getting file info: %w", err)
	}

	err = streamReadFromFile(fileData, info.Size, os.Stdout)
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

	info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: DefaultFileTimeout})
	err = convertNotFoundErr(err)
	if err == fs.ErrNotExist {
		return fmt.Errorf("%s: no such file", path)
	}
	if err != nil {
		return fmt.Errorf("getting file info: %w", err)
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
	fileData := wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: path}}

	_, err = wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: DefaultFileTimeout})
	err = convertNotFoundErr(err)
	if err == fs.ErrNotExist {
		return fmt.Errorf("%s: no such file", path)
	}
	if err != nil {
		return fmt.Errorf("getting file info: %w", err)
	}

	err = wshclient.FileDeleteCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: DefaultFileTimeout})
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

	_, err = ensureFile(path, fileData)
	if err != nil {
		return err
	}

	err = streamWriteToFile(fileData, WrappedStdin)
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

	info, err := ensureFile(path, fileData)
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

func getTargetPath(src, dst string) (string, error) {
	var srcBase string
	if strings.HasPrefix(src, WaveFilePrefix) {
		srcBase = path.Base(src)
	} else {
		srcBase = filepath.Base(src)
	}

	if strings.HasPrefix(dst, WaveFilePrefix) {
		// For wavefile URLs
		if strings.HasSuffix(dst, "/") {
			return dst + srcBase, nil
		}
		return dst, nil
	}

	// For local paths
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
	src, origDst := args[0], args[1]
	dst, err := getTargetPath(src, origDst)
	if err != nil {
		return err
	}
	srcIsWave := strings.HasPrefix(src, WaveFilePrefix)
	dstIsWave := strings.HasPrefix(dst, WaveFilePrefix)

	if srcIsWave == dstIsWave {
		return fmt.Errorf("exactly one file must be a wavefile:// URL")
	}

	if srcIsWave {
		return copyFromWaveToLocal(src, dst)
	} else {
		return copyFromLocalToWave(src, dst)
	}
}

func copyFromWaveToLocal(src, dst string) error {
	path, err := fixRelativePaths(src)
	if err != nil {
		return err
	}
	fileData := wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: path}}

	// Get file info first to check existence and get size
	info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
	err = convertNotFoundErr(err)
	if err == fs.ErrNotExist {
		return fmt.Errorf("%s: no such file", src)
	}
	if err != nil {
		return fmt.Errorf("getting file info: %w", err)
	}

	// Create the destination file
	f, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("creating local file: %w", err)
	}
	defer f.Close()

	err = streamReadFromFile(fileData, info.Size, f)
	if err != nil {
		return fmt.Errorf("reading wave file: %w", err)
	}

	return nil
}

func copyFromLocalToWave(src, dst string) error {
	path, err := fixRelativePaths(dst)
	if err != nil {
		return err
	}
	fileData := wshrpc.FileData{
		Info: &wshrpc.FileInfo{
			Path: path}}

	// stat local file
	stat, err := os.Stat(src)
	if err == fs.ErrNotExist {
		return fmt.Errorf("%s: no such file", src)
	}
	if err != nil {
		return fmt.Errorf("stat local file: %w", err)
	}
	if stat.IsDir() {
		return fmt.Errorf("%s: is a directory", src)
	}
	_, err = ensureFile(dst, fileData)
	if err != nil {
		return err
	}

	file, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("opening local file: %w", err)
	}
	defer file.Close()

	err = streamWriteToFile(fileData, file)
	if err != nil {
		return fmt.Errorf("writing wave file: %w", err)
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
				log.Printf("file: %s", f.Name)
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

	// Print samples
	for _, f := range samples {
		name := f.Name
		t := time.Unix(f.ModTime/1000, 0)
		timestamp := utilfn.FormatLsTime(t)
		if f.Size == 0 && strings.HasSuffix(name, "/") {
			fmt.Fprintf(os.Stdout, "%-*s  %8s  %s\n", nameWidth, name, "-", timestamp)
		} else {
			fmt.Fprintf(os.Stdout, "%-*s  %8d  %s\n", nameWidth, name, f.Size, timestamp)
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
				fmt.Fprintf(os.Stdout, "%-*s  %8s  %s\n", nameWidth, name, "-", timestamp)
			} else {
				fmt.Fprintf(os.Stdout, "%-*s  %8d  %s\n", nameWidth, name, f.Size, timestamp)
			}
		}
	}

	return nil
}

func fileListRun(cmd *cobra.Command, args []string) error {
	recursive, _ := cmd.Flags().GetBool("recursive")
	longForm, _ := cmd.Flags().GetBool("long")
	onePerLine, _ := cmd.Flags().GetBool("one")

	// Check if we're in a pipe
	stat, _ := os.Stdout.Stat()
	isPipe := (stat.Mode() & os.ModeCharDevice) == 0
	if isPipe {
		onePerLine = true
	}

	path, err := fixRelativePaths(args[0])
	if err != nil {
		return err
	}

	filesChan := wshclient.FileListStreamCommand(RpcClient, wshrpc.FileListData{Path: path, Opts: &wshrpc.FileListOpts{All: recursive}}, &wshrpc.RpcOpts{Timeout: 2000})
	log.Printf("list entries stream")

	if longForm {
		return filePrintLong(filesChan)
	}

	if onePerLine {
		log.Printf("onePerLine")
		for respUnion := range filesChan {
			if respUnion.Error != nil {
				log.Printf("error: %v", respUnion.Error)
				return respUnion.Error
			}
			for _, f := range respUnion.Response.FileInfo {
				log.Printf("file: %s", f.Name)
				fmt.Fprintln(os.Stdout, f.Name)
			}
			return nil
		}
	}

	return filePrintColumns(filesChan)
}

func fixRelativePaths(path string) (string, error) {
	conn, err := connparse.ParseURI(path)
	if err != nil {
		return "", err
	}
	if conn.Scheme == connparse.ConnectionTypeWsh && conn.Host == connparse.ConnHostCurrent {
		return fileutil.FixPath(conn.Path)
	}
	return path, nil
}
