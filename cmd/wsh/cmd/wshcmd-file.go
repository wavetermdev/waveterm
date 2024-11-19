// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const MaxFileSize = 10 * 1024 * 1024 // 10MB

var fileCmd = &cobra.Command{
	Use:   "file",
	Short: "manage Wave Terminal files",
	Long:  "Commands to manage Wave Terminal files stored in blocks",
}

var (
	fileLocal   bool
	fileTimeout int
)

func init() {
	rootCmd.AddCommand(fileCmd)

	// Add shared flags to all subcommands
	fileCmd.PersistentFlags().BoolVarP(&fileLocal, "local", "l", false, "operate on files local to block")
	fileWriteCmd.Flags().IntVarP(&fileTimeout, "timeout", "t", 60000, "timeout in milliseconds for write operation")

	fileCmd.AddCommand(fileCatCmd)
	fileCmd.AddCommand(fileWriteCmd)
	fileCmd.AddCommand(fileRmCmd)
	fileCmd.AddCommand(fileInfoCmd)
	fileCmd.AddCommand(fileAppendCmd)
	fileCmd.AddCommand(fileCpToCmd)
	fileCmd.AddCommand(fileCpFromCmd)
}

var fileCatCmd = &cobra.Command{
	Use:     "cat FILENAME",
	Short:   "display contents of a file",
	Args:    cobra.ExactArgs(1),
	RunE:    fileCatRun,
	PreRunE: preRunSetupRpcClient,
}

var fileInfoCmd = &cobra.Command{
	Use:     "info FILENAME",
	Short:   "show file information",
	Args:    cobra.ExactArgs(1),
	RunE:    fileInfoRun,
	PreRunE: preRunSetupRpcClient,
}

var fileRmCmd = &cobra.Command{
	Use:     "rm FILENAME",
	Short:   "remove a file",
	Args:    cobra.ExactArgs(1),
	RunE:    fileRmRun,
	PreRunE: preRunSetupRpcClient,
}

var fileWriteCmd = &cobra.Command{
	Use:     "write FILENAME",
	Short:   "write stdin into a file (up to 10MB)",
	Args:    cobra.ExactArgs(1),
	RunE:    fileWriteRun,
	PreRunE: preRunSetupRpcClient,
}

var fileAppendCmd = &cobra.Command{
	Use:     "append FILENAME",
	Short:   "append stdin to a file",
	Long:    "append stdin to a file, buffering input and respecting 10MB total file size limit",
	Args:    cobra.ExactArgs(1),
	RunE:    fileAppendRun,
	PreRunE: preRunSetupRpcClient,
}

var fileCpToCmd = &cobra.Command{
	Use:     "cpto WAVEFILE LOCALFILE",
	Short:   "copy from local file to wave file",
	Args:    cobra.ExactArgs(2),
	RunE:    fileCpToRun,
	PreRunE: preRunSetupRpcClient,
}

var fileCpFromCmd = &cobra.Command{
	Use:     "cpfrom WAVEFILE LOCALFILE",
	Short:   "copy from wave file to local file",
	Args:    cobra.ExactArgs(2),
	RunE:    fileCpFromRun,
	PreRunE: preRunSetupRpcClient,
}

func resolveFileZoneId() (*waveobj.ORef, error) {
	if blockArg == "" {
		if fileLocal {
			blockArg = "this"
		} else {
			blockArg = "client"
		}
	}
	return resolveBlockArg()
}

func fileCatRun(cmd *cobra.Command, args []string) error {
	fullORef, err := resolveFileZoneId()
	if err != nil {
		return err
	}

	fileData := wshrpc.CommandFileData{
		ZoneId:   fullORef.OID,
		FileName: args[0],
	}

	content64, err := wshclient.FileReadCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("reading file: %w", err)
	}

	content, err := base64.StdEncoding.DecodeString(content64)
	if err != nil {
		return fmt.Errorf("decoding file content: %w", err)
	}

	WriteStdout("%s", content)
	return nil
}

func fileInfoRun(cmd *cobra.Command, args []string) error {
	fullORef, err := resolveFileZoneId()
	if err != nil {
		return err
	}

	fileData := wshrpc.CommandFileData{
		ZoneId:   fullORef.OID,
		FileName: args[0],
	}

	info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("getting file info: %w", err)
	}

	WriteStdout("filename: %s\n", info.Name)
	WriteStdout("size:     %d\n", info.Size)
	WriteStdout("ctime:    %s\n", time.Unix(info.CreatedTs/1000, 0).Format(time.DateTime))
	WriteStdout("mtime:    %s\n", time.Unix(info.ModTs/1000, 0).Format(time.DateTime))
	if len(info.Meta) > 0 {
		WriteStdout("Metadata:\n")
		for k, v := range info.Meta {
			WriteStdout("  %s: %v\n", k, v)
		}
	}
	return nil
}

func fileRmRun(cmd *cobra.Command, args []string) error {
	fullORef, err := resolveFileZoneId()
	if err != nil {
		return err
	}

	fileData := wshrpc.CommandFileData{
		ZoneId:   fullORef.OID,
		FileName: args[0],
	}

	_, err = wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		if strings.HasPrefix(err.Error(), "NOTFOUND:") {
			return fmt.Errorf("%s: no such file", args[0])
		}
		return fmt.Errorf("getting file info: %w", err)
	}
	err = wshclient.FileDeleteCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("removing file: %w", err)
	}

	return nil
}

func fileWriteRun(cmd *cobra.Command, args []string) error {
	fullORef, err := resolveFileZoneId()
	if err != nil {
		return err
	}

	fileData := wshrpc.CommandFileData{
		ZoneId:   fullORef.OID,
		FileName: args[0],
	}
	finfo, infoErr := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
	if infoErr != nil && strings.HasPrefix(infoErr.Error(), "NOTFOUND:") {
		infoErr = nil
		// create the file
		createData := wshrpc.CommandFileCreateData{
			ZoneId:   fullORef.OID,
			FileName: args[0],
		}
		err = wshclient.FileCreateCommand(RpcClient, createData, &wshrpc.RpcOpts{Timeout: 2000})
		if err != nil {
			return fmt.Errorf("creating file: %w", err)
		}
	}
	if infoErr != nil {
		return fmt.Errorf("getting existing file info: %w", infoErr)
	}
	if finfo != nil && (finfo.Opts.IJson) {
		return fmt.Errorf("cannot write an IJSON file")
	}
	// Read all input up to MaxFileSize
	var buf bytes.Buffer
	limitedReader := io.LimitReader(WrappedStdin, MaxFileSize+1)
	n, err := buf.ReadFrom(limitedReader)
	if err != nil {
		return fmt.Errorf("reading input: %w", err)
	}
	if n > MaxFileSize {
		return fmt.Errorf("input exceeds maximum file size of %d bytes", MaxFileSize)
	}

	// Write the data
	fileData.Data64 = base64.StdEncoding.EncodeToString(buf.Bytes())
	err = wshclient.FileWriteCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
	if err != nil {
		return fmt.Errorf("writing file: %w", err)
	}

	return nil
}

func fileAppendRun(cmd *cobra.Command, args []string) error {
	fullORef, err := resolveFileZoneId()
	if err != nil {
		return err
	}

	fileData := wshrpc.CommandFileData{
		ZoneId:   fullORef.OID,
		FileName: args[0],
	}

	// Check current file size
	info, err := wshclient.FileInfoCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		// If file doesn't exist, create it
		createData := wshrpc.CommandFileCreateData{
			ZoneId:   fullORef.OID,
			FileName: args[0],
		}
		err = wshclient.FileCreateCommand(RpcClient, createData, &wshrpc.RpcOpts{Timeout: 2000})
		if err != nil {
			return fmt.Errorf("creating file: %w", err)
		}
		info = &filestore.WaveFile{Size: 0}
	}

	if info.Size >= MaxFileSize {
		return fmt.Errorf("file already at maximum size (%d bytes)", MaxFileSize)
	}

	// Set up buffered reader
	reader := bufio.NewReader(WrappedStdin)
	var buf bytes.Buffer
	remainingSpace := MaxFileSize - info.Size

	for {
		// Read a chunk
		chunk := make([]byte, 1024)
		n, err := reader.Read(chunk)
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("reading input: %w", err)
		}

		// Check if this chunk would exceed the limit
		if int64(buf.Len()+n) > remainingSpace {
			return fmt.Errorf("append would exceed maximum file size of %d bytes", MaxFileSize)
		}

		buf.Write(chunk[:n])

		// If we have enough data, do an append
		if buf.Len() >= 8192 { // 8KB batch size
			fileData.Data64 = base64.StdEncoding.EncodeToString(buf.Bytes())
			err = wshclient.FileAppendCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
			if err != nil {
				return fmt.Errorf("appending to file: %w", err)
			}
			remainingSpace -= int64(buf.Len())
			buf.Reset()
		}
	}

	// Append any remaining data
	if buf.Len() > 0 {
		fileData.Data64 = base64.StdEncoding.EncodeToString(buf.Bytes())
		err = wshclient.FileAppendCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: 2000})
		if err != nil {
			return fmt.Errorf("appending to file: %w", err)
		}
	}

	return nil
}

func fileCpToRun(cmd *cobra.Command, args []string) error {
	fullORef, err := resolveFileZoneId()
	if err != nil {
		return err
	}

	waveFile := args[0]
	localFile := args[1]

	// Read local file
	content, err := os.ReadFile(localFile)
	if err != nil {
		return fmt.Errorf("reading local file: %w", err)
	}
	if len(content) > MaxFileSize {
		return fmt.Errorf("file exceeds maximum size of %d bytes", MaxFileSize)
	}

	// Create the wave file
	createData := wshrpc.CommandFileCreateData{
		ZoneId:   fullORef.OID,
		FileName: waveFile,
	}
	err = wshclient.FileCreateCommand(RpcClient, createData, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("creating wave file: %w", err)
	}

	// Write the data
	fileData := wshrpc.CommandFileData{
		ZoneId:   fullORef.OID,
		FileName: waveFile,
		Data64:   base64.StdEncoding.EncodeToString(content),
	}
	err = wshclient.FileWriteCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
	if err != nil {
		return fmt.Errorf("writing wave file: %w", err)
	}

	return nil
}

func fileCpFromRun(cmd *cobra.Command, args []string) error {
	fullORef, err := resolveFileZoneId()
	if err != nil {
		return err
	}

	waveFile := args[0]
	localFile := args[1]

	// Read wave file
	fileData := wshrpc.CommandFileData{
		ZoneId:   fullORef.OID,
		FileName: waveFile,
	}

	content64, err := wshclient.FileReadCommand(RpcClient, fileData, &wshrpc.RpcOpts{Timeout: fileTimeout})
	if err != nil {
		return fmt.Errorf("reading wave file: %w", err)
	}

	content, err := base64.StdEncoding.DecodeString(content64)
	if err != nil {
		return fmt.Errorf("decoding file content: %w", err)
	}

	// Write to local file
	err = os.WriteFile(localFile, content, 0644)
	if err != nil {
		return fmt.Errorf("writing local file: %w", err)
	}

	return nil
}
