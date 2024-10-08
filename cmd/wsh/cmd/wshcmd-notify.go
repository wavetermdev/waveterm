// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

var notifyTitle string
var notifyBody string
var notifySilent bool

var setNotifyCmd = &cobra.Command{
	Use:     "notify [options]",
	Short:   "create a notification",
	Args:    cobra.NoArgs,
	Run:     notifyRun,
	PreRunE: preRunSetupRpcClient,
}

func init() {
	setNotifyCmd.Flags().StringVarP(&notifyTitle, "title", "t", "Wsh Notify", "the notification title")
	setNotifyCmd.Flags().StringVarP(&notifyBody, "message", "m", "", "the message within the notification")
	setNotifyCmd.Flags().BoolVarP(&notifySilent, "silent", "s", false, "whether or not the notification should display sound")
	rootCmd.AddCommand(setNotifyCmd)
}

func notifyRun(cmd *cobra.Command, args []string) {
	notificationOptions := &wshrpc.WaveNotificationOptions{
		Title:  notifyTitle,
		Body:   notifyBody,
		Silent: notifySilent,
	}
	_, err := RpcClient.SendRpcRequest(wshrpc.Command_Notify, notificationOptions, &wshrpc.RpcOpts{Timeout: 2000, Route: wshutil.ElectronRoute})
	if err != nil {
		WriteStderr("[error] sending notification: %v\n", err)
		return
	}
	WriteStdout("notification sent\n")
}
