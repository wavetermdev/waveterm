// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Generated Code. DO NOT EDIT.

package wshclient

import (
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wconfig"
)

// command "announce", wshserver.AnnounceCommand
func AnnounceCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "announce", data, opts)
	return err
}

// command "authenticate", wshserver.AuthenticateCommand
func AuthenticateCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) (wshrpc.CommandAuthenticateRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandAuthenticateRtnData](w, "authenticate", data, opts)
	return resp, err
}

// command "connconnect", wshserver.ConnConnectCommand
func ConnConnectCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "connconnect", data, opts)
	return err
}

// command "conndisconnect", wshserver.ConnDisconnectCommand
func ConnDisconnectCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "conndisconnect", data, opts)
	return err
}

// command "connensure", wshserver.ConnEnsureCommand
func ConnEnsureCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "connensure", data, opts)
	return err
}

// command "connreinstallwsh", wshserver.ConnReinstallWshCommand
func ConnReinstallWshCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "connreinstallwsh", data, opts)
	return err
}

// command "connstatus", wshserver.ConnStatusCommand
func ConnStatusCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]wshrpc.ConnStatus, error) {
	resp, err := sendRpcRequestCallHelper[[]wshrpc.ConnStatus](w, "connstatus", nil, opts)
	return resp, err
}

// command "controllerinput", wshserver.ControllerInputCommand
func ControllerInputCommand(w *wshutil.WshRpc, data wshrpc.CommandBlockInputData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "controllerinput", data, opts)
	return err
}

// command "controllerrestart", wshserver.ControllerRestartCommand
func ControllerRestartCommand(w *wshutil.WshRpc, data wshrpc.CommandBlockRestartData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "controllerrestart", data, opts)
	return err
}

// command "createblock", wshserver.CreateBlockCommand
func CreateBlockCommand(w *wshutil.WshRpc, data wshrpc.CommandCreateBlockData, opts *wshrpc.RpcOpts) (waveobj.ORef, error) {
	resp, err := sendRpcRequestCallHelper[waveobj.ORef](w, "createblock", data, opts)
	return resp, err
}

// command "deleteblock", wshserver.DeleteBlockCommand
func DeleteBlockCommand(w *wshutil.WshRpc, data wshrpc.CommandDeleteBlockData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "deleteblock", data, opts)
	return err
}

// command "eventpublish", wshserver.EventPublishCommand
func EventPublishCommand(w *wshutil.WshRpc, data wshrpc.WaveEvent, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "eventpublish", data, opts)
	return err
}

// command "eventreadhistory", wshserver.EventReadHistoryCommand
func EventReadHistoryCommand(w *wshutil.WshRpc, data wshrpc.CommandEventReadHistoryData, opts *wshrpc.RpcOpts) ([]*wshrpc.WaveEvent, error) {
	resp, err := sendRpcRequestCallHelper[[]*wshrpc.WaveEvent](w, "eventreadhistory", data, opts)
	return resp, err
}

// command "eventrecv", wshserver.EventRecvCommand
func EventRecvCommand(w *wshutil.WshRpc, data wshrpc.WaveEvent, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "eventrecv", data, opts)
	return err
}

// command "eventsub", wshserver.EventSubCommand
func EventSubCommand(w *wshutil.WshRpc, data wshrpc.SubscriptionRequest, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "eventsub", data, opts)
	return err
}

// command "eventunsub", wshserver.EventUnsubCommand
func EventUnsubCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "eventunsub", data, opts)
	return err
}

// command "eventunsuball", wshserver.EventUnsubAllCommand
func EventUnsubAllCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "eventunsuball", nil, opts)
	return err
}

// command "fileappend", wshserver.FileAppendCommand
func FileAppendCommand(w *wshutil.WshRpc, data wshrpc.CommandFileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "fileappend", data, opts)
	return err
}

// command "fileappendijson", wshserver.FileAppendIJsonCommand
func FileAppendIJsonCommand(w *wshutil.WshRpc, data wshrpc.CommandAppendIJsonData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "fileappendijson", data, opts)
	return err
}

// command "fileread", wshserver.FileReadCommand
func FileReadCommand(w *wshutil.WshRpc, data wshrpc.CommandFileData, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "fileread", data, opts)
	return resp, err
}

// command "filewrite", wshserver.FileWriteCommand
func FileWriteCommand(w *wshutil.WshRpc, data wshrpc.CommandFileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filewrite", data, opts)
	return err
}

// command "getmeta", wshserver.GetMetaCommand
func GetMetaCommand(w *wshutil.WshRpc, data wshrpc.CommandGetMetaData, opts *wshrpc.RpcOpts) (waveobj.MetaMapType, error) {
	resp, err := sendRpcRequestCallHelper[waveobj.MetaMapType](w, "getmeta", data, opts)
	return resp, err
}

// command "message", wshserver.MessageCommand
func MessageCommand(w *wshutil.WshRpc, data wshrpc.CommandMessageData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "message", data, opts)
	return err
}

// command "remotefiledelete", wshserver.RemoteFileDeleteCommand
func RemoteFileDeleteCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remotefiledelete", data, opts)
	return err
}

// command "remotefileinfo", wshserver.RemoteFileInfoCommand
func RemoteFileInfoCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) (*wshrpc.FileInfo, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FileInfo](w, "remotefileinfo", data, opts)
	return resp, err
}

// command "remotefilejoin", wshserver.RemoteFileJoinCommand
func RemoteFileJoinCommand(w *wshutil.WshRpc, data []string, opts *wshrpc.RpcOpts) (*wshrpc.FileInfo, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FileInfo](w, "remotefilejoin", data, opts)
	return resp, err
}

// command "remotestreamcpudata", wshserver.RemoteStreamCpuDataCommand
func RemoteStreamCpuDataCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.TimeSeriesData] {
	return sendRpcRequestResponseStreamHelper[wshrpc.TimeSeriesData](w, "remotestreamcpudata", nil, opts)
}

// command "remotestreamfile", wshserver.RemoteStreamFileCommand
func RemoteStreamFileCommand(w *wshutil.WshRpc, data wshrpc.CommandRemoteStreamFileData, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteStreamFileRtnData] {
	return sendRpcRequestResponseStreamHelper[wshrpc.CommandRemoteStreamFileRtnData](w, "remotestreamfile", data, opts)
}

// command "remotewritefile", wshserver.RemoteWriteFileCommand
func RemoteWriteFileCommand(w *wshutil.WshRpc, data wshrpc.CommandRemoteWriteFileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remotewritefile", data, opts)
	return err
}

// command "resolveids", wshserver.ResolveIdsCommand
func ResolveIdsCommand(w *wshutil.WshRpc, data wshrpc.CommandResolveIdsData, opts *wshrpc.RpcOpts) (wshrpc.CommandResolveIdsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandResolveIdsRtnData](w, "resolveids", data, opts)
	return resp, err
}

// command "setconfig", wshserver.SetConfigCommand
func SetConfigCommand(w *wshutil.WshRpc, data wconfig.MetaSettingsType, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setconfig", data, opts)
	return err
}

// command "setmeta", wshserver.SetMetaCommand
func SetMetaCommand(w *wshutil.WshRpc, data wshrpc.CommandSetMetaData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setmeta", data, opts)
	return err
}

// command "setview", wshserver.SetViewCommand
func SetViewCommand(w *wshutil.WshRpc, data wshrpc.CommandBlockSetViewData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setview", data, opts)
	return err
}

// command "streamcpudata", wshserver.StreamCpuDataCommand
func StreamCpuDataCommand(w *wshutil.WshRpc, data wshrpc.CpuDataRequest, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.TimeSeriesData] {
	return sendRpcRequestResponseStreamHelper[wshrpc.TimeSeriesData](w, "streamcpudata", data, opts)
}

// command "streamtest", wshserver.StreamTestCommand
func StreamTestCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[int] {
	return sendRpcRequestResponseStreamHelper[int](w, "streamtest", nil, opts)
}

// command "streamwaveai", wshserver.StreamWaveAiCommand
func StreamWaveAiCommand(w *wshutil.WshRpc, data wshrpc.OpenAiStreamRequest, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.OpenAIPacketType] {
	return sendRpcRequestResponseStreamHelper[wshrpc.OpenAIPacketType](w, "streamwaveai", data, opts)
}

// command "test", wshserver.TestCommand
func TestCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "test", data, opts)
	return err
}


