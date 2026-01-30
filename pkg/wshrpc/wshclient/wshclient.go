// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Generated Code. DO NOT EDIT.

package wshclient

import (
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

// command "activity", wshserver.ActivityCommand
func ActivityCommand(w *wshutil.WshRpc, data wshrpc.ActivityUpdate, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "activity", data, opts)
	return err
}

// command "aisendmessage", wshserver.AiSendMessageCommand
func AiSendMessageCommand(w *wshutil.WshRpc, data wshrpc.AiMessageData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "aisendmessage", data, opts)
	return err
}

// command "authenticate", wshserver.AuthenticateCommand
func AuthenticateCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) (wshrpc.CommandAuthenticateRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandAuthenticateRtnData](w, "authenticate", data, opts)
	return resp, err
}

// command "authenticatejobmanager", wshserver.AuthenticateJobManagerCommand
func AuthenticateJobManagerCommand(w *wshutil.WshRpc, data wshrpc.CommandAuthenticateJobManagerData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "authenticatejobmanager", data, opts)
	return err
}

// command "authenticatejobmanagerverify", wshserver.AuthenticateJobManagerVerifyCommand
func AuthenticateJobManagerVerifyCommand(w *wshutil.WshRpc, data wshrpc.CommandAuthenticateJobManagerData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "authenticatejobmanagerverify", data, opts)
	return err
}

// command "authenticatetojobmanager", wshserver.AuthenticateToJobManagerCommand
func AuthenticateToJobManagerCommand(w *wshutil.WshRpc, data wshrpc.CommandAuthenticateToJobData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "authenticatetojobmanager", data, opts)
	return err
}

// command "authenticatetoken", wshserver.AuthenticateTokenCommand
func AuthenticateTokenCommand(w *wshutil.WshRpc, data wshrpc.CommandAuthenticateTokenData, opts *wshrpc.RpcOpts) (wshrpc.CommandAuthenticateRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandAuthenticateRtnData](w, "authenticatetoken", data, opts)
	return resp, err
}

// command "authenticatetokenverify", wshserver.AuthenticateTokenVerifyCommand
func AuthenticateTokenVerifyCommand(w *wshutil.WshRpc, data wshrpc.CommandAuthenticateTokenData, opts *wshrpc.RpcOpts) (wshrpc.CommandAuthenticateRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandAuthenticateRtnData](w, "authenticatetokenverify", data, opts)
	return resp, err
}

// command "blockinfo", wshserver.BlockInfoCommand
func BlockInfoCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) (*wshrpc.BlockInfoData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.BlockInfoData](w, "blockinfo", data, opts)
	return resp, err
}

// command "blockslist", wshserver.BlocksListCommand
func BlocksListCommand(w *wshutil.WshRpc, data wshrpc.BlocksListRequest, opts *wshrpc.RpcOpts) ([]wshrpc.BlocksListEntry, error) {
	resp, err := sendRpcRequestCallHelper[[]wshrpc.BlocksListEntry](w, "blockslist", data, opts)
	return resp, err
}

// command "captureblockscreenshot", wshserver.CaptureBlockScreenshotCommand
func CaptureBlockScreenshotCommand(w *wshutil.WshRpc, data wshrpc.CommandCaptureBlockScreenshotData, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "captureblockscreenshot", data, opts)
	return resp, err
}

// command "connconnect", wshserver.ConnConnectCommand
func ConnConnectCommand(w *wshutil.WshRpc, data wshrpc.ConnRequest, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "connconnect", data, opts)
	return err
}

// command "conndisconnect", wshserver.ConnDisconnectCommand
func ConnDisconnectCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "conndisconnect", data, opts)
	return err
}

// command "connensure", wshserver.ConnEnsureCommand
func ConnEnsureCommand(w *wshutil.WshRpc, data wshrpc.ConnExtData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "connensure", data, opts)
	return err
}

// command "connlist", wshserver.ConnListCommand
func ConnListCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]string, error) {
	resp, err := sendRpcRequestCallHelper[[]string](w, "connlist", nil, opts)
	return resp, err
}

// command "connreinstallwsh", wshserver.ConnReinstallWshCommand
func ConnReinstallWshCommand(w *wshutil.WshRpc, data wshrpc.ConnExtData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "connreinstallwsh", data, opts)
	return err
}

// command "connserverinit", wshserver.ConnServerInitCommand
func ConnServerInitCommand(w *wshutil.WshRpc, data wshrpc.CommandConnServerInitData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "connserverinit", data, opts)
	return err
}

// command "connstatus", wshserver.ConnStatusCommand
func ConnStatusCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]wshrpc.ConnStatus, error) {
	resp, err := sendRpcRequestCallHelper[[]wshrpc.ConnStatus](w, "connstatus", nil, opts)
	return resp, err
}

// command "connupdatewsh", wshserver.ConnUpdateWshCommand
func ConnUpdateWshCommand(w *wshutil.WshRpc, data wshrpc.RemoteInfo, opts *wshrpc.RpcOpts) (bool, error) {
	resp, err := sendRpcRequestCallHelper[bool](w, "connupdatewsh", data, opts)
	return resp, err
}

// command "controlgetrouteid", wshserver.ControlGetRouteIdCommand
func ControlGetRouteIdCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "controlgetrouteid", nil, opts)
	return resp, err
}

// command "controllerappendoutput", wshserver.ControllerAppendOutputCommand
func ControllerAppendOutputCommand(w *wshutil.WshRpc, data wshrpc.CommandControllerAppendOutputData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "controllerappendoutput", data, opts)
	return err
}

// command "controllerdestroy", wshserver.ControllerDestroyCommand
func ControllerDestroyCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "controllerdestroy", data, opts)
	return err
}

// command "controllerinput", wshserver.ControllerInputCommand
func ControllerInputCommand(w *wshutil.WshRpc, data wshrpc.CommandBlockInputData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "controllerinput", data, opts)
	return err
}

// command "controllerresync", wshserver.ControllerResyncCommand
func ControllerResyncCommand(w *wshutil.WshRpc, data wshrpc.CommandControllerResyncData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "controllerresync", data, opts)
	return err
}

// command "createblock", wshserver.CreateBlockCommand
func CreateBlockCommand(w *wshutil.WshRpc, data wshrpc.CommandCreateBlockData, opts *wshrpc.RpcOpts) (waveobj.ORef, error) {
	resp, err := sendRpcRequestCallHelper[waveobj.ORef](w, "createblock", data, opts)
	return resp, err
}

// command "createsubblock", wshserver.CreateSubBlockCommand
func CreateSubBlockCommand(w *wshutil.WshRpc, data wshrpc.CommandCreateSubBlockData, opts *wshrpc.RpcOpts) (waveobj.ORef, error) {
	resp, err := sendRpcRequestCallHelper[waveobj.ORef](w, "createsubblock", data, opts)
	return resp, err
}

// command "deleteblock", wshserver.DeleteBlockCommand
func DeleteBlockCommand(w *wshutil.WshRpc, data wshrpc.CommandDeleteBlockData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "deleteblock", data, opts)
	return err
}

// command "deletesubblock", wshserver.DeleteSubBlockCommand
func DeleteSubBlockCommand(w *wshutil.WshRpc, data wshrpc.CommandDeleteBlockData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "deletesubblock", data, opts)
	return err
}

// command "detectavailableshells", wshserver.DetectAvailableShellsCommand
func DetectAvailableShellsCommand(w *wshutil.WshRpc, data wshrpc.DetectShellsRequest, opts *wshrpc.RpcOpts) (wshrpc.DetectShellsResponse, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.DetectShellsResponse](w, "detectavailableshells", data, opts)
	return resp, err
}

// command "dismisswshfail", wshserver.DismissWshFailCommand
func DismissWshFailCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "dismisswshfail", data, opts)
	return err
}

// command "dispose", wshserver.DisposeCommand
func DisposeCommand(w *wshutil.WshRpc, data wshrpc.CommandDisposeData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "dispose", data, opts)
	return err
}

// command "disposesuggestions", wshserver.DisposeSuggestionsCommand
func DisposeSuggestionsCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "disposesuggestions", data, opts)
	return err
}

// command "electrondecrypt", wshserver.ElectronDecryptCommand
func ElectronDecryptCommand(w *wshutil.WshRpc, data wshrpc.CommandElectronDecryptData, opts *wshrpc.RpcOpts) (*wshrpc.CommandElectronDecryptRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandElectronDecryptRtnData](w, "electrondecrypt", data, opts)
	return resp, err
}

// command "electronencrypt", wshserver.ElectronEncryptCommand
func ElectronEncryptCommand(w *wshutil.WshRpc, data wshrpc.CommandElectronEncryptData, opts *wshrpc.RpcOpts) (*wshrpc.CommandElectronEncryptRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandElectronEncryptRtnData](w, "electronencrypt", data, opts)
	return resp, err
}

// command "electronsystembell", wshserver.ElectronSystemBellCommand
func ElectronSystemBellCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "electronsystembell", nil, opts)
	return err
}

// command "eventpublish", wshserver.EventPublishCommand
func EventPublishCommand(w *wshutil.WshRpc, data wps.WaveEvent, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "eventpublish", data, opts)
	return err
}

// command "eventreadhistory", wshserver.EventReadHistoryCommand
func EventReadHistoryCommand(w *wshutil.WshRpc, data wshrpc.CommandEventReadHistoryData, opts *wshrpc.RpcOpts) ([]*wps.WaveEvent, error) {
	resp, err := sendRpcRequestCallHelper[[]*wps.WaveEvent](w, "eventreadhistory", data, opts)
	return resp, err
}

// command "eventrecv", wshserver.EventRecvCommand
func EventRecvCommand(w *wshutil.WshRpc, data wps.WaveEvent, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "eventrecv", data, opts)
	return err
}

// command "eventsub", wshserver.EventSubCommand
func EventSubCommand(w *wshutil.WshRpc, data wps.SubscriptionRequest, opts *wshrpc.RpcOpts) error {
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

// command "fetchsuggestions", wshserver.FetchSuggestionsCommand
func FetchSuggestionsCommand(w *wshutil.WshRpc, data wshrpc.FetchSuggestionsData, opts *wshrpc.RpcOpts) (*wshrpc.FetchSuggestionsResponse, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FetchSuggestionsResponse](w, "fetchsuggestions", data, opts)
	return resp, err
}

// command "fileappend", wshserver.FileAppendCommand
func FileAppendCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "fileappend", data, opts)
	return err
}

// command "filecopy", wshserver.FileCopyCommand
func FileCopyCommand(w *wshutil.WshRpc, data wshrpc.CommandFileCopyData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filecopy", data, opts)
	return err
}

// command "filecreate", wshserver.FileCreateCommand
func FileCreateCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filecreate", data, opts)
	return err
}

// command "filedelete", wshserver.FileDeleteCommand
func FileDeleteCommand(w *wshutil.WshRpc, data wshrpc.CommandDeleteFileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filedelete", data, opts)
	return err
}

// command "fileinfo", wshserver.FileInfoCommand
func FileInfoCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) (*wshrpc.FileInfo, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FileInfo](w, "fileinfo", data, opts)
	return resp, err
}

// command "filejoin", wshserver.FileJoinCommand
func FileJoinCommand(w *wshutil.WshRpc, data []string, opts *wshrpc.RpcOpts) (*wshrpc.FileInfo, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FileInfo](w, "filejoin", data, opts)
	return resp, err
}

// command "filelist", wshserver.FileListCommand
func FileListCommand(w *wshutil.WshRpc, data wshrpc.FileListData, opts *wshrpc.RpcOpts) ([]*wshrpc.FileInfo, error) {
	resp, err := sendRpcRequestCallHelper[[]*wshrpc.FileInfo](w, "filelist", data, opts)
	return resp, err
}

// command "fileliststream", wshserver.FileListStreamCommand
func FileListStreamCommand(w *wshutil.WshRpc, data wshrpc.FileListData, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	return sendRpcRequestResponseStreamHelper[wshrpc.CommandRemoteListEntriesRtnData](w, "fileliststream", data, opts)
}

// command "filemkdir", wshserver.FileMkdirCommand
func FileMkdirCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filemkdir", data, opts)
	return err
}

// command "filemove", wshserver.FileMoveCommand
func FileMoveCommand(w *wshutil.WshRpc, data wshrpc.CommandFileCopyData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filemove", data, opts)
	return err
}

// command "fileread", wshserver.FileReadCommand
func FileReadCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) (*wshrpc.FileData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.FileData](w, "fileread", data, opts)
	return resp, err
}

// command "filereadstream", wshserver.FileReadStreamCommand
func FileReadStreamCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	return sendRpcRequestResponseStreamHelper[wshrpc.FileData](w, "filereadstream", data, opts)
}

// command "filerestorebackup", wshserver.FileRestoreBackupCommand
func FileRestoreBackupCommand(w *wshutil.WshRpc, data wshrpc.CommandFileRestoreBackupData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filerestorebackup", data, opts)
	return err
}

// command "filewrite", wshserver.FileWriteCommand
func FileWriteCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "filewrite", data, opts)
	return err
}

// command "findgitbash", wshserver.FindGitBashCommand
func FindGitBashCommand(w *wshutil.WshRpc, data bool, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "findgitbash", data, opts)
	return resp, err
}

// command "focuswindow", wshserver.FocusWindowCommand
func FocusWindowCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "focuswindow", data, opts)
	return err
}

// command "getalltabindicators", wshserver.GetAllTabIndicatorsCommand
func GetAllTabIndicatorsCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (map[string]*wshrpc.TabIndicator, error) {
	resp, err := sendRpcRequestCallHelper[map[string]*wshrpc.TabIndicator](w, "getalltabindicators", nil, opts)
	return resp, err
}

// command "getallvars", wshserver.GetAllVarsCommand
func GetAllVarsCommand(w *wshutil.WshRpc, data wshrpc.CommandVarData, opts *wshrpc.RpcOpts) ([]wshrpc.CommandVarResponseData, error) {
	resp, err := sendRpcRequestCallHelper[[]wshrpc.CommandVarResponseData](w, "getallvars", data, opts)
	return resp, err
}

// command "getfullconfig", wshserver.GetFullConfigCommand
func GetFullConfigCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (wconfig.FullConfigType, error) {
	resp, err := sendRpcRequestCallHelper[wconfig.FullConfigType](w, "getfullconfig", nil, opts)
	return resp, err
}

// command "getjwtpublickey", wshserver.GetJwtPublicKeyCommand
func GetJwtPublicKeyCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "getjwtpublickey", nil, opts)
	return resp, err
}

// command "getmeta", wshserver.GetMetaCommand
func GetMetaCommand(w *wshutil.WshRpc, data wshrpc.CommandGetMetaData, opts *wshrpc.RpcOpts) (waveobj.MetaMapType, error) {
	resp, err := sendRpcRequestCallHelper[waveobj.MetaMapType](w, "getmeta", data, opts)
	return resp, err
}

// command "getrtinfo", wshserver.GetRTInfoCommand
func GetRTInfoCommand(w *wshutil.WshRpc, data wshrpc.CommandGetRTInfoData, opts *wshrpc.RpcOpts) (*waveobj.ObjRTInfo, error) {
	resp, err := sendRpcRequestCallHelper[*waveobj.ObjRTInfo](w, "getrtinfo", data, opts)
	return resp, err
}

// command "getsecrets", wshserver.GetSecretsCommand
func GetSecretsCommand(w *wshutil.WshRpc, data []string, opts *wshrpc.RpcOpts) (map[string]string, error) {
	resp, err := sendRpcRequestCallHelper[map[string]string](w, "getsecrets", data, opts)
	return resp, err
}

// command "getsecretslinuxstoragebackend", wshserver.GetSecretsLinuxStorageBackendCommand
func GetSecretsLinuxStorageBackendCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "getsecretslinuxstoragebackend", nil, opts)
	return resp, err
}

// command "getsecretsnames", wshserver.GetSecretsNamesCommand
func GetSecretsNamesCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]string, error) {
	resp, err := sendRpcRequestCallHelper[[]string](w, "getsecretsnames", nil, opts)
	return resp, err
}

// command "gettab", wshserver.GetTabCommand
func GetTabCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) (*waveobj.Tab, error) {
	resp, err := sendRpcRequestCallHelper[*waveobj.Tab](w, "gettab", data, opts)
	return resp, err
}

// command "gettempdir", wshserver.GetTempDirCommand
func GetTempDirCommand(w *wshutil.WshRpc, data wshrpc.CommandGetTempDirData, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "gettempdir", data, opts)
	return resp, err
}

// command "getupdatechannel", wshserver.GetUpdateChannelCommand
func GetUpdateChannelCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "getupdatechannel", nil, opts)
	return resp, err
}

// command "getvar", wshserver.GetVarCommand
func GetVarCommand(w *wshutil.WshRpc, data wshrpc.CommandVarData, opts *wshrpc.RpcOpts) (*wshrpc.CommandVarResponseData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandVarResponseData](w, "getvar", data, opts)
	return resp, err
}

// command "getwaveaichat", wshserver.GetWaveAIChatCommand
func GetWaveAIChatCommand(w *wshutil.WshRpc, data wshrpc.CommandGetWaveAIChatData, opts *wshrpc.RpcOpts) (*uctypes.UIChat, error) {
	resp, err := sendRpcRequestCallHelper[*uctypes.UIChat](w, "getwaveaichat", data, opts)
	return resp, err
}

// command "getwaveaimodeconfig", wshserver.GetWaveAIModeConfigCommand
func GetWaveAIModeConfigCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (wconfig.AIModeConfigUpdate, error) {
	resp, err := sendRpcRequestCallHelper[wconfig.AIModeConfigUpdate](w, "getwaveaimodeconfig", nil, opts)
	return resp, err
}

// command "getwaveairatelimit", wshserver.GetWaveAIRateLimitCommand
func GetWaveAIRateLimitCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*uctypes.RateLimitInfo, error) {
	resp, err := sendRpcRequestCallHelper[*uctypes.RateLimitInfo](w, "getwaveairatelimit", nil, opts)
	return resp, err
}

// command "jobcmdexited", wshserver.JobCmdExitedCommand
func JobCmdExitedCommand(w *wshutil.WshRpc, data wshrpc.CommandJobCmdExitedData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "jobcmdexited", data, opts)
	return err
}

// command "jobcontrollerattachjob", wshserver.JobControllerAttachJobCommand
func JobControllerAttachJobCommand(w *wshutil.WshRpc, data wshrpc.CommandJobControllerAttachJobData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "jobcontrollerattachjob", data, opts)
	return err
}

// command "jobcontrollerconnectedjobs", wshserver.JobControllerConnectedJobsCommand
func JobControllerConnectedJobsCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]string, error) {
	resp, err := sendRpcRequestCallHelper[[]string](w, "jobcontrollerconnectedjobs", nil, opts)
	return resp, err
}

// command "jobcontrollerdeletejob", wshserver.JobControllerDeleteJobCommand
func JobControllerDeleteJobCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "jobcontrollerdeletejob", data, opts)
	return err
}

// command "jobcontrollerdetachjob", wshserver.JobControllerDetachJobCommand
func JobControllerDetachJobCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "jobcontrollerdetachjob", data, opts)
	return err
}

// command "jobcontrollerdisconnectjob", wshserver.JobControllerDisconnectJobCommand
func JobControllerDisconnectJobCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "jobcontrollerdisconnectjob", data, opts)
	return err
}

// command "jobcontrollerexitjob", wshserver.JobControllerExitJobCommand
func JobControllerExitJobCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "jobcontrollerexitjob", data, opts)
	return err
}

// command "jobcontrollerlist", wshserver.JobControllerListCommand
func JobControllerListCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]*waveobj.Job, error) {
	resp, err := sendRpcRequestCallHelper[[]*waveobj.Job](w, "jobcontrollerlist", nil, opts)
	return resp, err
}

// command "jobcontrollerreconnectjob", wshserver.JobControllerReconnectJobCommand
func JobControllerReconnectJobCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "jobcontrollerreconnectjob", data, opts)
	return err
}

// command "jobcontrollerreconnectjobsforconn", wshserver.JobControllerReconnectJobsForConnCommand
func JobControllerReconnectJobsForConnCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "jobcontrollerreconnectjobsforconn", data, opts)
	return err
}

// command "jobcontrollerstartjob", wshserver.JobControllerStartJobCommand
func JobControllerStartJobCommand(w *wshutil.WshRpc, data wshrpc.CommandJobControllerStartJobData, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "jobcontrollerstartjob", data, opts)
	return resp, err
}

// command "jobinput", wshserver.JobInputCommand
func JobInputCommand(w *wshutil.WshRpc, data wshrpc.CommandJobInputData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "jobinput", data, opts)
	return err
}

// command "jobprepareconnect", wshserver.JobPrepareConnectCommand
func JobPrepareConnectCommand(w *wshutil.WshRpc, data wshrpc.CommandJobPrepareConnectData, opts *wshrpc.RpcOpts) (*wshrpc.CommandJobConnectRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandJobConnectRtnData](w, "jobprepareconnect", data, opts)
	return resp, err
}

// command "jobstartstream", wshserver.JobStartStreamCommand
func JobStartStreamCommand(w *wshutil.WshRpc, data wshrpc.CommandJobStartStreamData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "jobstartstream", data, opts)
	return err
}

// command "message", wshserver.MessageCommand
func MessageCommand(w *wshutil.WshRpc, data wshrpc.CommandMessageData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "message", data, opts)
	return err
}

// command "networkonline", wshserver.NetworkOnlineCommand
func NetworkOnlineCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (bool, error) {
	resp, err := sendRpcRequestCallHelper[bool](w, "networkonline", nil, opts)
	return resp, err
}

// command "notify", wshserver.NotifyCommand
func NotifyCommand(w *wshutil.WshRpc, data wshrpc.WaveNotificationOptions, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "notify", data, opts)
	return err
}

// command "ompanalyze", wshserver.OmpAnalyzeCommand
func OmpAnalyzeCommand(w *wshutil.WshRpc, data wshrpc.CommandOmpAnalyzeData, opts *wshrpc.RpcOpts) (wshrpc.CommandOmpAnalyzeRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandOmpAnalyzeRtnData](w, "ompanalyze", data, opts)
	return resp, err
}

// command "ompapplyhighcontrast", wshserver.OmpApplyHighContrastCommand
func OmpApplyHighContrastCommand(w *wshutil.WshRpc, data wshrpc.CommandOmpApplyHighContrastData, opts *wshrpc.RpcOpts) (wshrpc.CommandOmpApplyHighContrastRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandOmpApplyHighContrastRtnData](w, "ompapplyhighcontrast", data, opts)
	return resp, err
}

// command "ompgetconfiginfo", wshserver.OmpGetConfigInfoCommand
func OmpGetConfigInfoCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (wshrpc.CommandOmpGetConfigInfoRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandOmpGetConfigInfoRtnData](w, "ompgetconfiginfo", nil, opts)
	return resp, err
}

// command "ompreadconfig", wshserver.OmpReadConfigCommand
func OmpReadConfigCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (wshrpc.CommandOmpReadConfigRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandOmpReadConfigRtnData](w, "ompreadconfig", nil, opts)
	return resp, err
}

// command "ompreinit", wshserver.OmpReinitCommand
func OmpReinitCommand(w *wshutil.WshRpc, data wshrpc.CommandOmpReinitData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "ompreinit", data, opts)
	return err
}

// command "omprestorebackup", wshserver.OmpRestoreBackupCommand
func OmpRestoreBackupCommand(w *wshutil.WshRpc, data wshrpc.CommandOmpRestoreBackupData, opts *wshrpc.RpcOpts) (wshrpc.CommandOmpRestoreBackupRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandOmpRestoreBackupRtnData](w, "omprestorebackup", data, opts)
	return resp, err
}

// command "ompwriteconfig", wshserver.OmpWriteConfigCommand
func OmpWriteConfigCommand(w *wshutil.WshRpc, data wshrpc.CommandOmpWriteConfigData, opts *wshrpc.RpcOpts) (wshrpc.CommandOmpWriteConfigRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandOmpWriteConfigRtnData](w, "ompwriteconfig", data, opts)
	return resp, err
}

// command "ompwritepalette", wshserver.OmpWritePaletteCommand
func OmpWritePaletteCommand(w *wshutil.WshRpc, data wshrpc.CommandOmpWritePaletteData, opts *wshrpc.RpcOpts) (wshrpc.CommandOmpWritePaletteRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandOmpWritePaletteRtnData](w, "ompwritepalette", data, opts)
	return resp, err
}

// command "path", wshserver.PathCommand
func PathCommand(w *wshutil.WshRpc, data wshrpc.PathCommandData, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "path", data, opts)
	return resp, err
}

// command "remotedisconnectfromjobmanager", wshserver.RemoteDisconnectFromJobManagerCommand
func RemoteDisconnectFromJobManagerCommand(w *wshutil.WshRpc, data wshrpc.CommandRemoteDisconnectFromJobManagerData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remotedisconnectfromjobmanager", data, opts)
	return err
}

// command "remotefilecopy", wshserver.RemoteFileCopyCommand
func RemoteFileCopyCommand(w *wshutil.WshRpc, data wshrpc.CommandFileCopyData, opts *wshrpc.RpcOpts) (bool, error) {
	resp, err := sendRpcRequestCallHelper[bool](w, "remotefilecopy", data, opts)
	return resp, err
}

// command "remotefiledelete", wshserver.RemoteFileDeleteCommand
func RemoteFileDeleteCommand(w *wshutil.WshRpc, data wshrpc.CommandDeleteFileData, opts *wshrpc.RpcOpts) error {
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

// command "remotefilemove", wshserver.RemoteFileMoveCommand
func RemoteFileMoveCommand(w *wshutil.WshRpc, data wshrpc.CommandFileCopyData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remotefilemove", data, opts)
	return err
}

// command "remotefiletouch", wshserver.RemoteFileTouchCommand
func RemoteFileTouchCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remotefiletouch", data, opts)
	return err
}

// command "remotegetinfo", wshserver.RemoteGetInfoCommand
func RemoteGetInfoCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (wshrpc.RemoteInfo, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.RemoteInfo](w, "remotegetinfo", nil, opts)
	return resp, err
}

// command "remoteinstallrcfiles", wshserver.RemoteInstallRcFilesCommand
func RemoteInstallRcFilesCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remoteinstallrcfiles", nil, opts)
	return err
}

// command "remotelistentries", wshserver.RemoteListEntriesCommand
func RemoteListEntriesCommand(w *wshutil.WshRpc, data wshrpc.CommandRemoteListEntriesData, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	return sendRpcRequestResponseStreamHelper[wshrpc.CommandRemoteListEntriesRtnData](w, "remotelistentries", data, opts)
}

// command "remotemkdir", wshserver.RemoteMkdirCommand
func RemoteMkdirCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remotemkdir", data, opts)
	return err
}

// command "remotereconnecttojobmanager", wshserver.RemoteReconnectToJobManagerCommand
func RemoteReconnectToJobManagerCommand(w *wshutil.WshRpc, data wshrpc.CommandRemoteReconnectToJobManagerData, opts *wshrpc.RpcOpts) (*wshrpc.CommandRemoteReconnectToJobManagerRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandRemoteReconnectToJobManagerRtnData](w, "remotereconnecttojobmanager", data, opts)
	return resp, err
}

// command "remotestartjob", wshserver.RemoteStartJobCommand
func RemoteStartJobCommand(w *wshutil.WshRpc, data wshrpc.CommandRemoteStartJobData, opts *wshrpc.RpcOpts) (*wshrpc.CommandStartJobRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandStartJobRtnData](w, "remotestartjob", data, opts)
	return resp, err
}

// command "remotestreamcpudata", wshserver.RemoteStreamCpuDataCommand
func RemoteStreamCpuDataCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.TimeSeriesData] {
	return sendRpcRequestResponseStreamHelper[wshrpc.TimeSeriesData](w, "remotestreamcpudata", nil, opts)
}

// command "remotestreamfile", wshserver.RemoteStreamFileCommand
func RemoteStreamFileCommand(w *wshutil.WshRpc, data wshrpc.CommandRemoteStreamFileData, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.FileData] {
	return sendRpcRequestResponseStreamHelper[wshrpc.FileData](w, "remotestreamfile", data, opts)
}

// command "remoteterminatejobmanager", wshserver.RemoteTerminateJobManagerCommand
func RemoteTerminateJobManagerCommand(w *wshutil.WshRpc, data wshrpc.CommandRemoteTerminateJobManagerData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remoteterminatejobmanager", data, opts)
	return err
}

// command "remotewritefile", wshserver.RemoteWriteFileCommand
func RemoteWriteFileCommand(w *wshutil.WshRpc, data wshrpc.FileData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "remotewritefile", data, opts)
	return err
}

// command "resolveids", wshserver.ResolveIdsCommand
func ResolveIdsCommand(w *wshutil.WshRpc, data wshrpc.CommandResolveIdsData, opts *wshrpc.RpcOpts) (wshrpc.CommandResolveIdsRtnData, error) {
	resp, err := sendRpcRequestCallHelper[wshrpc.CommandResolveIdsRtnData](w, "resolveids", data, opts)
	return resp, err
}

// command "routeannounce", wshserver.RouteAnnounceCommand
func RouteAnnounceCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "routeannounce", nil, opts)
	return err
}

// command "routeunannounce", wshserver.RouteUnannounceCommand
func RouteUnannounceCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "routeunannounce", nil, opts)
	return err
}

// command "setconfig", wshserver.SetConfigCommand
func SetConfigCommand(w *wshutil.WshRpc, data wshrpc.MetaSettingsType, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setconfig", data, opts)
	return err
}

// command "setconnectionsconfig", wshserver.SetConnectionsConfigCommand
func SetConnectionsConfigCommand(w *wshutil.WshRpc, data wshrpc.ConnConfigRequest, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setconnectionsconfig", data, opts)
	return err
}

// command "setmeta", wshserver.SetMetaCommand
func SetMetaCommand(w *wshutil.WshRpc, data wshrpc.CommandSetMetaData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setmeta", data, opts)
	return err
}

// command "setpeerinfo", wshserver.SetPeerInfoCommand
func SetPeerInfoCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setpeerinfo", data, opts)
	return err
}

// command "setrtinfo", wshserver.SetRTInfoCommand
func SetRTInfoCommand(w *wshutil.WshRpc, data wshrpc.CommandSetRTInfoData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setrtinfo", data, opts)
	return err
}

// command "setsecrets", wshserver.SetSecretsCommand
func SetSecretsCommand(w *wshutil.WshRpc, data map[string]*string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setsecrets", data, opts)
	return err
}

// command "setvar", wshserver.SetVarCommand
func SetVarCommand(w *wshutil.WshRpc, data wshrpc.CommandVarData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "setvar", data, opts)
	return err
}

// command "startjob", wshserver.StartJobCommand
func StartJobCommand(w *wshutil.WshRpc, data wshrpc.CommandStartJobData, opts *wshrpc.RpcOpts) (*wshrpc.CommandStartJobRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandStartJobRtnData](w, "startjob", data, opts)
	return resp, err
}

// command "streamcpudata", wshserver.StreamCpuDataCommand
func StreamCpuDataCommand(w *wshutil.WshRpc, data wshrpc.CpuDataRequest, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.TimeSeriesData] {
	return sendRpcRequestResponseStreamHelper[wshrpc.TimeSeriesData](w, "streamcpudata", data, opts)
}

// command "streamdata", wshserver.StreamDataCommand
func StreamDataCommand(w *wshutil.WshRpc, data wshrpc.CommandStreamData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "streamdata", data, opts)
	return err
}

// command "streamdataack", wshserver.StreamDataAckCommand
func StreamDataAckCommand(w *wshutil.WshRpc, data wshrpc.CommandStreamAckData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "streamdataack", data, opts)
	return err
}

// command "streamtest", wshserver.StreamTestCommand
func StreamTestCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[int] {
	return sendRpcRequestResponseStreamHelper[int](w, "streamtest", nil, opts)
}

// command "streamwaveai", wshserver.StreamWaveAiCommand
func StreamWaveAiCommand(w *wshutil.WshRpc, data wshrpc.WaveAIStreamRequest, opts *wshrpc.RpcOpts) chan wshrpc.RespOrErrorUnion[wshrpc.WaveAIPacketType] {
	return sendRpcRequestResponseStreamHelper[wshrpc.WaveAIPacketType](w, "streamwaveai", data, opts)
}

// command "termgetscrollbacklines", wshserver.TermGetScrollbackLinesCommand
func TermGetScrollbackLinesCommand(w *wshutil.WshRpc, data wshrpc.CommandTermGetScrollbackLinesData, opts *wshrpc.RpcOpts) (*wshrpc.CommandTermGetScrollbackLinesRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandTermGetScrollbackLinesRtnData](w, "termgetscrollbacklines", data, opts)
	return resp, err
}

// command "termupdateattachedjob", wshserver.TermUpdateAttachedJobCommand
func TermUpdateAttachedJobCommand(w *wshutil.WshRpc, data wshrpc.CommandTermUpdateAttachedJobData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "termupdateattachedjob", data, opts)
	return err
}

// command "test", wshserver.TestCommand
func TestCommand(w *wshutil.WshRpc, data string, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "test", data, opts)
	return err
}

// command "waitforroute", wshserver.WaitForRouteCommand
func WaitForRouteCommand(w *wshutil.WshRpc, data wshrpc.CommandWaitForRouteData, opts *wshrpc.RpcOpts) (bool, error) {
	resp, err := sendRpcRequestCallHelper[bool](w, "waitforroute", data, opts)
	return resp, err
}

// command "waveaiaddcontext", wshserver.WaveAIAddContextCommand
func WaveAIAddContextCommand(w *wshutil.WshRpc, data wshrpc.CommandWaveAIAddContextData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "waveaiaddcontext", data, opts)
	return err
}

// command "waveaigettooldiff", wshserver.WaveAIGetToolDiffCommand
func WaveAIGetToolDiffCommand(w *wshutil.WshRpc, data wshrpc.CommandWaveAIGetToolDiffData, opts *wshrpc.RpcOpts) (*wshrpc.CommandWaveAIGetToolDiffRtnData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.CommandWaveAIGetToolDiffRtnData](w, "waveaigettooldiff", data, opts)
	return resp, err
}

// command "waveaitoolapprove", wshserver.WaveAIToolApproveCommand
func WaveAIToolApproveCommand(w *wshutil.WshRpc, data wshrpc.CommandWaveAIToolApproveData, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "waveaitoolapprove", data, opts)
	return err
}

// command "wavefilereadstream", wshserver.WaveFileReadStreamCommand
func WaveFileReadStreamCommand(w *wshutil.WshRpc, data wshrpc.CommandWaveFileReadStreamData, opts *wshrpc.RpcOpts) (*wshrpc.WaveFileInfo, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.WaveFileInfo](w, "wavefilereadstream", data, opts)
	return resp, err
}

// command "waveinfo", wshserver.WaveInfoCommand
func WaveInfoCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (*wshrpc.WaveInfoData, error) {
	resp, err := sendRpcRequestCallHelper[*wshrpc.WaveInfoData](w, "waveinfo", nil, opts)
	return resp, err
}

// command "webselector", wshserver.WebSelectorCommand
func WebSelectorCommand(w *wshutil.WshRpc, data wshrpc.CommandWebSelectorData, opts *wshrpc.RpcOpts) ([]string, error) {
	resp, err := sendRpcRequestCallHelper[[]string](w, "webselector", data, opts)
	return resp, err
}

// command "workspacelist", wshserver.WorkspaceListCommand
func WorkspaceListCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]wshrpc.WorkspaceInfoData, error) {
	resp, err := sendRpcRequestCallHelper[[]wshrpc.WorkspaceInfoData](w, "workspacelist", nil, opts)
	return resp, err
}

// command "writetempfile", wshserver.WriteTempFileCommand
func WriteTempFileCommand(w *wshutil.WshRpc, data wshrpc.CommandWriteTempFileData, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "writetempfile", data, opts)
	return resp, err
}

// command "wshactivity", wshserver.WshActivityCommand
func WshActivityCommand(w *wshutil.WshRpc, data map[string]int, opts *wshrpc.RpcOpts) error {
	_, err := sendRpcRequestCallHelper[any](w, "wshactivity", data, opts)
	return err
}

// command "wsldefaultdistro", wshserver.WslDefaultDistroCommand
func WslDefaultDistroCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) (string, error) {
	resp, err := sendRpcRequestCallHelper[string](w, "wsldefaultdistro", nil, opts)
	return resp, err
}

// command "wsllist", wshserver.WslListCommand
func WslListCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]string, error) {
	resp, err := sendRpcRequestCallHelper[[]string](w, "wsllist", nil, opts)
	return resp, err
}

// command "wslstatus", wshserver.WslStatusCommand
func WslStatusCommand(w *wshutil.WshRpc, opts *wshrpc.RpcOpts) ([]wshrpc.ConnStatus, error) {
	resp, err := sendRpcRequestCallHelper[[]wshrpc.ConnStatus](w, "wslstatus", nil, opts)
	return resp, err
}


