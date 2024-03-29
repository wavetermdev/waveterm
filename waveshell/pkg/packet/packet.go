// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package packet

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"reflect"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/wlog"
)

// single          : <init, >run, >cmddata, >cmddone, <cmdstart, <>data, <>dataack, <cmddone
// single(detached): <init, >run, >cmddata, >cmddone, <cmdstart
// server          : <init, >run, >cmddata, >cmddone, <cmdstart, <>data, <>dataack, <cmddone
//                   >cd, >getcmd, >untailcmd, >input, <resp
// all             : <>error, <>message, <>ping, <raw
//
// >streamfile, <streamfileresp, <filedata*
// >writefile, <writefileready, >filedata*, <writefiledone

const MaxCompGenValues = 100

var GlobalDebug = false

const (
	RunPacketStr            = "run" // rpc
	PingPacketStr           = "ping"
	InitPacketStr           = "init"
	DataPacketStr           = "data"     // command
	DataAckPacketStr        = "dataack"  // command
	CmdStartPacketStr       = "cmdstart" // rpc-response
	CmdDonePacketStr        = "cmddone"  // command
	DataEndPacketStr        = "dataend"
	ResponsePacketStr       = "resp" // rpc-response
	DonePacketStr           = "done"
	MessagePacketStr        = "message"
	GetCmdPacketStr         = "getcmd"    // rpc
	UntailCmdPacketStr      = "untailcmd" // rpc
	CdPacketStr             = "cd"        // rpc
	RawPacketStr            = "raw"
	SpecialInputPacketStr   = "sinput"         // command
	CompGenPacketStr        = "compgen"        // rpc
	ReInitPacketStr         = "reinit"         // rpc
	CmdFinalPacketStr       = "cmdfinal"       // command, pushed at the "end" of a command (fail-safe for no cmddone)
	StreamFilePacketStr     = "streamfile"     // rpc
	StreamFileResponseStr   = "streamfileresp" // rpc-response
	WriteFilePacketStr      = "writefile"      // rpc
	WriteFileReadyPacketStr = "writefileready" // rpc-response
	WriteFileDonePacketStr  = "writefiledone"  // rpc-response
	FileDataPacketStr       = "filedata"
	FileStatPacketStr       = "filestat"
	LogPacketStr            = "log" // logging packet (sent from waveshell back to server)
	ShellStatePacketStr     = "shellstate"
	RpcInputPacketStr       = "rpcinput" // rpc-followup

	OpenAIPacketStr   = "openai" // other
	OpenAICloudReqStr = "openai-cloudreq"

	DefaultEphemeralTimeoutMs = 5000
)

const (
	ShellType_bash = "bash"
	ShellType_zsh  = "zsh"
)

const (
	EC_InvalidCwd    = "ERRCWD"
	EC_CmdNotRunning = "CMDNOTRUNNING"
)

const PacketSenderQueueSize = 20

const PacketEOFStr = "EOF"

var TypeStrToFactory map[string]reflect.Type

const OpenAICmdInfoChatGreetingMessage = "Hello, may I help you with this command?  \n(Ctrl-Space: open, ESC: close, Ctrl+L: clear chat buffer, Up/Down: select code blocks, Enter: to copy a selected code block to the command input)"

func init() {
	TypeStrToFactory = make(map[string]reflect.Type)
	TypeStrToFactory[RunPacketStr] = reflect.TypeOf(RunPacketType{})
	TypeStrToFactory[PingPacketStr] = reflect.TypeOf(PingPacketType{})
	TypeStrToFactory[ResponsePacketStr] = reflect.TypeOf(ResponsePacketType{})
	TypeStrToFactory[DonePacketStr] = reflect.TypeOf(DonePacketType{})
	TypeStrToFactory[MessagePacketStr] = reflect.TypeOf(MessagePacketType{})
	TypeStrToFactory[CmdStartPacketStr] = reflect.TypeOf(CmdStartPacketType{})
	TypeStrToFactory[CmdDonePacketStr] = reflect.TypeOf(CmdDonePacketType{})
	TypeStrToFactory[GetCmdPacketStr] = reflect.TypeOf(GetCmdPacketType{})
	TypeStrToFactory[UntailCmdPacketStr] = reflect.TypeOf(UntailCmdPacketType{})
	TypeStrToFactory[InitPacketStr] = reflect.TypeOf(InitPacketType{})
	TypeStrToFactory[CdPacketStr] = reflect.TypeOf(CdPacketType{})
	TypeStrToFactory[RawPacketStr] = reflect.TypeOf(RawPacketType{})
	TypeStrToFactory[SpecialInputPacketStr] = reflect.TypeOf(SpecialInputPacketType{})
	TypeStrToFactory[DataPacketStr] = reflect.TypeOf(DataPacketType{})
	TypeStrToFactory[DataAckPacketStr] = reflect.TypeOf(DataAckPacketType{})
	TypeStrToFactory[DataEndPacketStr] = reflect.TypeOf(DataEndPacketType{})
	TypeStrToFactory[CompGenPacketStr] = reflect.TypeOf(CompGenPacketType{})
	TypeStrToFactory[ReInitPacketStr] = reflect.TypeOf(ReInitPacketType{})
	TypeStrToFactory[CmdFinalPacketStr] = reflect.TypeOf(CmdFinalPacketType{})
	TypeStrToFactory[StreamFilePacketStr] = reflect.TypeOf(StreamFilePacketType{})
	TypeStrToFactory[StreamFileResponseStr] = reflect.TypeOf(StreamFileResponseType{})
	TypeStrToFactory[OpenAIPacketStr] = reflect.TypeOf(OpenAIPacketType{})
	TypeStrToFactory[FileDataPacketStr] = reflect.TypeOf(FileDataPacketType{})
	TypeStrToFactory[WriteFilePacketStr] = reflect.TypeOf(WriteFilePacketType{})
	TypeStrToFactory[WriteFileReadyPacketStr] = reflect.TypeOf(WriteFileReadyPacketType{})
	TypeStrToFactory[WriteFileDonePacketStr] = reflect.TypeOf(WriteFileDonePacketType{})
	TypeStrToFactory[LogPacketStr] = reflect.TypeOf(LogPacketType{})
	TypeStrToFactory[ShellStatePacketStr] = reflect.TypeOf(ShellStatePacketType{})
	TypeStrToFactory[FileStatPacketStr] = reflect.TypeOf(FileStatPacketType{})
	TypeStrToFactory[RpcInputPacketStr] = reflect.TypeOf(RpcInputPacketType{})

	var _ RpcPacketType = (*RunPacketType)(nil)
	var _ RpcPacketType = (*GetCmdPacketType)(nil)
	var _ RpcPacketType = (*UntailCmdPacketType)(nil)
	var _ RpcPacketType = (*CdPacketType)(nil)
	var _ RpcPacketType = (*CompGenPacketType)(nil)
	var _ RpcPacketType = (*ReInitPacketType)(nil)
	var _ RpcPacketType = (*StreamFilePacketType)(nil)
	var _ RpcPacketType = (*WriteFilePacketType)(nil)

	var _ RpcResponsePacketType = (*CmdStartPacketType)(nil)
	var _ RpcResponsePacketType = (*ResponsePacketType)(nil)
	var _ RpcResponsePacketType = (*StreamFileResponseType)(nil)
	var _ RpcResponsePacketType = (*FileDataPacketType)(nil)
	var _ RpcResponsePacketType = (*WriteFileReadyPacketType)(nil)
	var _ RpcResponsePacketType = (*WriteFileDonePacketType)(nil)
	var _ RpcResponsePacketType = (*ShellStatePacketType)(nil)

	var _ RpcFollowUpPacketType = (*FileDataPacketType)(nil)
	var _ RpcFollowUpPacketType = (*RpcInputPacketType)(nil)

	var _ CommandPacketType = (*DataPacketType)(nil)
	var _ CommandPacketType = (*DataAckPacketType)(nil)
	var _ CommandPacketType = (*CmdDonePacketType)(nil)
	var _ CommandPacketType = (*SpecialInputPacketType)(nil)
	var _ CommandPacketType = (*CmdFinalPacketType)(nil)
}

func RegisterPacketType(typeStr string, rtype reflect.Type) {
	TypeStrToFactory[typeStr] = rtype
}

func MakePacket(packetType string) (PacketType, error) {
	rtype := TypeStrToFactory[packetType]
	if rtype == nil {
		return nil, fmt.Errorf("invalid packet type '%s'", packetType)
	}
	rtn := reflect.New(rtype)
	return rtn.Interface().(PacketType), nil
}

type PingPacketType struct {
	Type string `json:"type"`
}

func (*PingPacketType) GetType() string {
	return PingPacketStr
}

func MakePingPacket() *PingPacketType {
	return &PingPacketType{Type: PingPacketStr}
}

type RpcInputPacketType struct {
	Type  string `json:"type"`
	ReqId string `json:"reqid"`
	Data  []byte `json:"data"`
}

func (*RpcInputPacketType) GetType() string {
	return RpcInputPacketStr
}

func (p *RpcInputPacketType) GetAssociatedReqId() string {
	return p.ReqId
}

func MakeRpcInputPacket(reqId string) *RpcInputPacketType {
	return &RpcInputPacketType{Type: RpcInputPacketStr, ReqId: reqId}
}

// these packets can travel either direction
// so it is both a RpcResponsePacketType and an RpcFollowUpPacketType
type FileDataPacketType struct {
	Type   string `json:"type"`
	RespId string `json:"respid"`
	Data   []byte `json:"data"`
	Eof    bool   `json:"eof,omitempty"`
	Error  string `json:"error,omitempty"`
}

func (*FileDataPacketType) GetType() string {
	return FileDataPacketStr
}

func MakeFileDataPacket(reqId string) *FileDataPacketType {
	return &FileDataPacketType{
		Type:   FileDataPacketStr,
		RespId: reqId,
	}
}

func (p *FileDataPacketType) GetAssociatedReqId() string {
	return p.RespId
}

func (p *FileDataPacketType) GetResponseId() string {
	return p.RespId
}

func (p *FileDataPacketType) GetResponseDone() bool {
	return p.Eof || p.Error != ""
}

type DataPacketType struct {
	Type   string          `json:"type"`
	CK     base.CommandKey `json:"ck"`
	FdNum  int             `json:"fdnum"`
	Data64 string          `json:"data64"` // base64 encoded
	Eof    bool            `json:"eof,omitempty"`
	Error  string          `json:"error,omitempty"`
}

func (*DataPacketType) GetType() string {
	return DataPacketStr
}

func (p *DataPacketType) GetCK() base.CommandKey {
	return p.CK
}

func B64DecodedLen(b64 string) int {
	if len(b64) < 4 {
		return 0 // we use padded strings, so < 4 is always 0
	}
	realLen := 3 * (len(b64) / 4)
	if b64[len(b64)-1] == '=' {
		realLen--
	}
	if b64[len(b64)-2] == '=' {
		realLen--
	}
	return realLen
}

func (p *DataPacketType) String() string {
	eofStr := ""
	if p.Eof {
		eofStr = ", eof"
	}
	errStr := ""
	if p.Error != "" {
		errStr = fmt.Sprintf(", err=%s", p.Error)
	}
	return fmt.Sprintf("data[fd=%d, len=%d%s%s]", p.FdNum, B64DecodedLen(p.Data64), eofStr, errStr)
}

func MakeDataPacket() *DataPacketType {
	return &DataPacketType{Type: DataPacketStr}
}

type DataEndPacketType struct {
	Type string          `json:"type"`
	CK   base.CommandKey `json:"ck"`
}

func MakeDataEndPacket(ck base.CommandKey) *DataEndPacketType {
	return &DataEndPacketType{Type: DataEndPacketStr, CK: ck}
}

func (*DataEndPacketType) GetType() string {
	return DataEndPacketStr
}

type DataAckPacketType struct {
	Type   string          `json:"type"`
	CK     base.CommandKey `json:"ck"`
	FdNum  int             `json:"fdnum"`
	AckLen int             `json:"acklen"`
	Error  string          `json:"error,omitempty"`
}

func (*DataAckPacketType) GetType() string {
	return DataAckPacketStr
}

func (p *DataAckPacketType) GetCK() base.CommandKey {
	return p.CK
}

func (p *DataAckPacketType) String() string {
	errStr := ""
	if p.Error != "" {
		errStr = fmt.Sprintf(" err=%s", p.Error)
	}
	return fmt.Sprintf("ack[fd=%d, acklen=%d%s]", p.FdNum, p.AckLen, errStr)
}

func MakeDataAckPacket() *DataAckPacketType {
	return &DataAckPacketType{Type: DataAckPacketStr}
}

type WinSize struct {
	Rows int `json:"rows"`
	Cols int `json:"cols"`
}

// SigNum gets sent to process via a signal
// WinSize, if set, will run TIOCSWINSZ to set size, and then send SIGWINCH
type SpecialInputPacketType struct {
	Type    string          `json:"type"`
	CK      base.CommandKey `json:"ck"`
	SigName string          `json:"signame,omitempty"` // passed to unix.SignalNum (needs 'SIG' prefix, e.g. "SIGTERM"), also accepts a number (e.g. "9")
	WinSize *WinSize        `json:"winsize,omitempty"`
}

func (*SpecialInputPacketType) GetType() string {
	return SpecialInputPacketStr
}

func (p *SpecialInputPacketType) GetCK() base.CommandKey {
	return p.CK
}

func MakeSpecialInputPacket() *SpecialInputPacketType {
	return &SpecialInputPacketType{Type: SpecialInputPacketStr}
}

type UntailCmdPacketType struct {
	Type  string          `json:"type"`
	ReqId string          `json:"reqid"`
	CK    base.CommandKey `json:"ck"`
}

func (*UntailCmdPacketType) GetType() string {
	return UntailCmdPacketStr
}

func (p *UntailCmdPacketType) GetReqId() string {
	return p.ReqId
}

func MakeUntailCmdPacket() *UntailCmdPacketType {
	return &UntailCmdPacketType{Type: UntailCmdPacketStr}
}

type GetCmdPacketType struct {
	Type    string          `json:"type"`
	ReqId   string          `json:"reqid"`
	CK      base.CommandKey `json:"ck"`
	PtyPos  int64           `json:"ptypos"`
	RunPos  int64           `json:"runpos"`
	Tail    bool            `json:"tail,omitempty"`
	PtyOnly bool            `json:"ptyonly,omitempty"`
}

func (*GetCmdPacketType) GetType() string {
	return GetCmdPacketStr
}

func (p *GetCmdPacketType) GetReqId() string {
	return p.ReqId
}

func MakeGetCmdPacket() *GetCmdPacketType {
	return &GetCmdPacketType{Type: GetCmdPacketStr}
}

type CdPacketType struct {
	Type  string `json:"type"`
	ReqId string `json:"reqid"`
	Dir   string `json:"dir"`
}

func (*CdPacketType) GetType() string {
	return CdPacketStr
}

func (p *CdPacketType) GetReqId() string {
	return p.ReqId
}

func MakeCdPacket() *CdPacketType {
	return &CdPacketType{Type: CdPacketStr}
}

type ReInitPacketType struct {
	Type      string `json:"type"`
	ShellType string `json:"shelltype"`
	ReqId     string `json:"reqid"`
}

func (*ReInitPacketType) GetType() string {
	return ReInitPacketStr
}

func (p *ReInitPacketType) GetReqId() string {
	return p.ReqId
}

func MakeReInitPacket() *ReInitPacketType {
	return &ReInitPacketType{Type: ReInitPacketStr}
}

type FileStatPacketType struct {
	Type    string    `json:"type"`
	Name    string    `json:"name"`
	Size    int64     `json:"size"`
	ModTs   time.Time `json:"modts"`
	IsDir   bool      `json:"isdir"`
	Perm    int       `json:"perm"`
	ModeStr string    `json:"modestr"`
	Error   string    `json:"error"`
	Done    bool      `json:"done"`
	RespId  string    `json:"respid"`
	Path    string    `json:"path"`
}

func (*FileStatPacketType) GetType() string {
	return FileStatPacketStr
}

func (p *FileStatPacketType) GetResponseDone() bool {
	return p.Done
}

func (p *FileStatPacketType) GetResponseId() string {
	return p.RespId
}

func MakeFileStatPacketType() *FileStatPacketType {
	return &FileStatPacketType{Type: FileStatPacketStr}
}

func MakeFileStatPacketFromFileInfo(finfo fs.FileInfo, err string, done bool) *FileStatPacketType {
	resp := MakeFileStatPacketType()
	resp.Error = err
	resp.Done = done

	resp.IsDir = finfo.IsDir()
	resp.Name = finfo.Name()

	resp.Size = finfo.Size()
	resp.ModTs = finfo.ModTime()
	resp.Perm = int(finfo.Mode().Perm())
	resp.ModeStr = finfo.Mode().String()
	return resp
}

type StreamFilePacketType struct {
	Type      string  `json:"type"`
	ReqId     string  `json:"reqid"`
	Path      string  `json:"path"`
	ByteRange []int64 `json:"byterange"`          // works like the http "Range" header (multiple ranges are not allowed)
	StatOnly  bool    `json:"statonly,omitempty"` // set if you just want the stat response (no data returned)
}

func (*StreamFilePacketType) GetType() string {
	return StreamFilePacketStr
}

func (p *StreamFilePacketType) GetReqId() string {
	return p.ReqId
}

func MakeStreamFilePacket() *StreamFilePacketType {
	return &StreamFilePacketType{Type: StreamFilePacketStr}
}

type FileInfo struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	ModTs    int64  `json:"modts"`
	IsDir    bool   `json:"isdir,omitempty"`
	Perm     int    `json:"perm"`
	NotFound bool   `json:"notfound,omitempty"` // when NotFound is set, Perm will be set to permission for directory
}

type StreamFileResponseType struct {
	Type   string    `json:"type"`
	RespId string    `json:"respid"`
	Done   bool      `json:"done,omitempty"`
	Info   *FileInfo `json:"info,omitempty"`
	Error  string    `json:"error,omitempty"`
}

func (*StreamFileResponseType) GetType() string {
	return StreamFileResponseStr
}

func (p *StreamFileResponseType) GetResponseId() string {
	return p.RespId
}

func (p *StreamFileResponseType) GetResponseDone() bool {
	return p.Done
}

func MakeStreamFileResponse(respId string) *StreamFileResponseType {
	return &StreamFileResponseType{
		Type:   StreamFileResponseStr,
		RespId: respId,
	}
}

type CompGenPacketType struct {
	Type     string `json:"type"`
	ReqId    string `json:"reqid"`
	Prefix   string `json:"prefix"`
	CompType string `json:"comptype"`
	Cwd      string `json:"cwd"`
}

func IsValidCompGenType(t string) bool {
	return (t == "file" || t == "command" || t == "directory" || t == "variable")
}

func (*CompGenPacketType) GetType() string {
	return CompGenPacketStr
}

func (p *CompGenPacketType) GetReqId() string {
	return p.ReqId
}

func MakeCompGenPacket() *CompGenPacketType {
	return &CompGenPacketType{Type: CompGenPacketStr}
}

type ResponsePacketType struct {
	Type      string      `json:"type"`
	RespId    string      `json:"respid"`
	Success   bool        `json:"success"`
	Error     string      `json:"error,omitempty"`
	ErrorCode string      `json:"errorcode,omitempty"` // can be used for structured errors
	Data      interface{} `json:"data,omitempty"`
}

func (*ResponsePacketType) GetType() string {
	return ResponsePacketStr
}

func (p *ResponsePacketType) GetResponseId() string {
	return p.RespId
}

func (*ResponsePacketType) GetResponseDone() bool {
	return true
}

func (p *ResponsePacketType) Err() error {
	if p == nil {
		return fmt.Errorf("no response received")
	}
	if !p.Success {
		if p.Error != "" {
			if p.ErrorCode != "" {
				return &base.CodedError{ErrorCode: p.ErrorCode, Err: errors.New(p.Error)}
			}
			return errors.New(p.Error)
		}
		return fmt.Errorf("rpc failed")
	}
	return nil
}

func (p *ResponsePacketType) String() string {
	if p.Success {
		return "response[success]"
	}
	return fmt.Sprintf("response[error:%s]", p.Error)
}

func MakeErrorResponsePacket(reqId string, err error) *ResponsePacketType {
	if codedErr, ok := err.(*base.CodedError); ok {
		return &ResponsePacketType{Type: ResponsePacketStr, RespId: reqId, Error: codedErr.Err.Error(), ErrorCode: codedErr.ErrorCode}
	}
	return &ResponsePacketType{Type: ResponsePacketStr, RespId: reqId, Error: err.Error()}
}

func MakeResponsePacket(reqId string, data interface{}) *ResponsePacketType {
	return &ResponsePacketType{Type: ResponsePacketStr, RespId: reqId, Success: true, Data: data}
}

type RawPacketType struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

func (*RawPacketType) GetType() string {
	return RawPacketStr
}

func (p *RawPacketType) String() string {
	return fmt.Sprintf("raw[%s]", p.Data)
}

func MakeRawPacket(val string) *RawPacketType {
	return &RawPacketType{Type: RawPacketStr, Data: val}
}

type LogPacketType struct {
	Type  string        `json:"type"`
	Entry wlog.LogEntry `json:"entry"`
}

func (*LogPacketType) GetType() string {
	return LogPacketStr
}

func (p *LogPacketType) String() string {
	return "log"
}

func MakeLogPacket(entry wlog.LogEntry) *LogPacketType {
	return &LogPacketType{Type: LogPacketStr, Entry: entry}
}

type ShellStatePacketType struct {
	Type      string           `json:"type"`
	ShellType string           `json:"shelltype"`
	RespId    string           `json:"respid,omitempty"`
	State     *ShellState      `json:"state"`
	Stats     *ShellStateStats `json:"stats"`
	Error     string           `json:"error,omitempty"`
}

func (*ShellStatePacketType) GetType() string {
	return ShellStatePacketStr
}

func (p *ShellStatePacketType) String() string {
	return fmt.Sprintf("shellstate[%s]", p.ShellType)
}

func (p *ShellStatePacketType) GetResponseId() string {
	return p.RespId
}

func (p *ShellStatePacketType) GetResponseDone() bool {
	return true
}

func MakeShellStatePacket() *ShellStatePacketType {
	return &ShellStatePacketType{Type: ShellStatePacketStr}
}

type MessagePacketType struct {
	Type    string          `json:"type"`
	CK      base.CommandKey `json:"ck,omitempty"`
	Message string          `json:"message"`
}

func (*MessagePacketType) GetType() string {
	return MessagePacketStr
}

func (p *MessagePacketType) String() string {
	return fmt.Sprintf("messsage[%s]", p.Message)
}

func MakeMessagePacket(message string) *MessagePacketType {
	return &MessagePacketType{Type: MessagePacketStr, Message: message}
}

func FmtMessagePacket(fmtStr string, args ...interface{}) *MessagePacketType {
	message := fmt.Sprintf(fmtStr, args...)
	return &MessagePacketType{Type: MessagePacketStr, Message: message}
}

type InitPacketType struct {
	Type          string `json:"type"`
	RespId        string `json:"respid,omitempty"`
	Version       string `json:"version"`
	BuildTime     string `json:"buildtime,omitempty"`
	MShellHomeDir string `json:"mshellhomedir,omitempty"`
	HomeDir       string `json:"homedir,omitempty"`
	User          string `json:"user,omitempty"`
	HostName      string `json:"hostname,omitempty"`
	NotFound      bool   `json:"notfound,omitempty"`
	UName         string `json:"uname,omitempty"`
	Shell         string `json:"shell,omitempty"`
	RemoteId      string `json:"remoteid,omitempty"`
}

func (*InitPacketType) GetType() string {
	return InitPacketStr
}

func (pk *InitPacketType) GetResponseId() string {
	return pk.RespId
}

func (pk *InitPacketType) GetResponseDone() bool {
	return true
}

func MakeInitPacket() *InitPacketType {
	return &InitPacketType{Type: InitPacketStr}
}

type DonePacketType struct {
	Type string `json:"type"`
}

func (*DonePacketType) GetType() string {
	return DonePacketStr
}

func MakeDonePacket() *DonePacketType {
	return &DonePacketType{Type: DonePacketStr}
}

type CmdFinalPacketType struct {
	Type  string          `json:"type"`
	Ts    int64           `json:"ts"`
	CK    base.CommandKey `json:"ck"`
	Error string          `json:"error"`
}

func (*CmdFinalPacketType) GetType() string {
	return CmdFinalPacketStr
}

func (pk *CmdFinalPacketType) GetCK() base.CommandKey {
	return pk.CK
}

func MakeCmdFinalPacket(ck base.CommandKey) *CmdFinalPacketType {
	return &CmdFinalPacketType{Type: CmdFinalPacketStr, CK: ck}
}

type CmdDonePacketType struct {
	Type           string          `json:"type"`
	Ts             int64           `json:"ts"`
	CK             base.CommandKey `json:"ck"`
	ExitCode       int             `json:"exitcode"`
	DurationMs     int64           `json:"durationms"`
	FinalState     *ShellState     `json:"finalstate,omitempty"`
	FinalStateDiff *ShellStateDiff `json:"finalstatediff,omitempty"`
}

func (*CmdDonePacketType) GetType() string {
	return CmdDonePacketStr
}

func (p *CmdDonePacketType) GetCK() base.CommandKey {
	return p.CK
}

func MakeCmdDonePacket(ck base.CommandKey) *CmdDonePacketType {
	return &CmdDonePacketType{Type: CmdDonePacketStr, CK: ck}
}

type CmdStartPacketType struct {
	Type      string          `json:"type"`
	RespId    string          `json:"respid,omitempty"`
	Ts        int64           `json:"ts"`
	CK        base.CommandKey `json:"ck"`
	Pid       int             `json:"pid,omitempty"`
	MShellPid int             `json:"mshellpid,omitempty"`
}

func (*CmdStartPacketType) GetType() string {
	return CmdStartPacketStr
}

func (p *CmdStartPacketType) GetResponseId() string {
	return p.RespId
}

func (*CmdStartPacketType) GetResponseDone() bool {
	return true
}

func MakeCmdStartPacket(reqId string) *CmdStartPacketType {
	return &CmdStartPacketType{Type: CmdStartPacketStr, RespId: reqId}
}

type TermOpts struct {
	Rows       int    `json:"rows"`
	Cols       int    `json:"cols"`
	Term       string `json:"term"`
	MaxPtySize int64  `json:"maxptysize,omitempty"`
	FlexRows   bool   `json:"flexrows,omitempty"`
}

type RemoteFd struct {
	FdNum    int  `json:"fdnum"`
	Read     bool `json:"read"`
	Write    bool `json:"write"`
	DupStdin bool `json:"-"`
}

type RunDataType struct {
	FdNum   int    `json:"fdnum"`
	DataLen int    `json:"datalen"`
	Data    []byte `json:"-"`
}

// Options specific to ephemeral commands (commands that are not saved to the history)
type EphemeralRunOpts struct {
	OverrideCwd     string         `json:"overridecwd,omitempty"` // A directory to use as the current working directory. Defaults to the last set shell state.
	TimeoutMs       int64          `json:"timeoutms"`             // The maximum time to wait for the command to complete. If the command does not complete within this time, it is killed.
	ExpectsResponse bool           `json:"expectsresponse"`       // If set, the command is expected to return a response. If this is false, ResposeWriter is not set.
	ResponseWriter  io.WriteCloser `json:"-"`                     // A writer to receive the command's output. If not set, the command's output is discarded. (set by remote.go)
	Canceled        atomic.Bool    `json:"canceled,omitempty"`    // If set, the command was canceled before it completed.
}

type RunPacketType struct {
	Type          string            `json:"type"`
	ReqId         string            `json:"reqid"`
	CK            base.CommandKey   `json:"ck"`
	ShellType     string            `json:"shelltype"` // new in v0.6.0 (either "bash" or "zsh") (set by remote.go)
	Command       string            `json:"command"`
	State         *ShellState       `json:"state,omitempty"`
	StateDiff     *ShellStateDiff   `json:"statediff,omitempty"`
	StateComplete bool              `json:"statecomplete,omitempty"` // set to true if state is complete (the default env should not be set)
	UsePty        bool              `json:"usepty,omitempty"`
	TermOpts      *TermOpts         `json:"termopts,omitempty"`
	Fds           []RemoteFd        `json:"fds,omitempty"`
	RunData       []RunDataType     `json:"rundata,omitempty"`
	Detached      bool              `json:"detached,omitempty"`
	ReturnState   bool              `json:"returnstate,omitempty"`
	EphemeralOpts *EphemeralRunOpts `json:"ephemeralopts,omitempty"` // options specific to ephemeral commands
}

func (*RunPacketType) GetType() string {
	return RunPacketStr
}

func (p *RunPacketType) GetReqId() string {
	return p.ReqId
}

func MakeRunPacket() *RunPacketType {
	return &RunPacketType{Type: RunPacketStr}
}

type OpenAIUsageType struct {
	PromptTokens     int `json:"prompt_tokens,omitempty"`
	CompletionTokens int `json:"completion_tokens,omitempty"`
	TotalTokens      int `json:"total_tokens,omitempty"`
}

type OpenAICmdInfoPacketOutputType struct {
	Model        string `json:"model,omitempty"`
	Created      int64  `json:"created,omitempty"`
	FinishReason string `json:"finish_reason,omitempty"`
	Message      string `json:"message,omitempty"`
	Error        string `json:"error,omitempty"`
}

type OpenAIPacketType struct {
	Type         string           `json:"type"`
	Model        string           `json:"model,omitempty"`
	Created      int64            `json:"created,omitempty"`
	FinishReason string           `json:"finish_reason,omitempty"`
	Usage        *OpenAIUsageType `json:"usage,omitempty"`
	Index        int              `json:"index,omitempty"`
	Text         string           `json:"text,omitempty"`
	Error        string           `json:"error,omitempty"`
}

func (*OpenAIPacketType) GetType() string {
	return OpenAIPacketStr
}

func MakeOpenAIPacket() *OpenAIPacketType {
	return &OpenAIPacketType{Type: OpenAIPacketStr}
}

type BarePacketType struct {
	Type string `json:"type"`
}

type WriteFilePacketType struct {
	Type    string `json:"type"`
	ReqId   string `json:"reqid"`
	UseTemp bool   `json:"usetemp,omitempty"`
	Path    string `json:"path"`
}

func (*WriteFilePacketType) GetType() string {
	return WriteFilePacketStr
}

func (p *WriteFilePacketType) GetReqId() string {
	return p.ReqId
}

func MakeWriteFilePacket() *WriteFilePacketType {
	return &WriteFilePacketType{Type: WriteFilePacketStr}
}

type WriteFileReadyPacketType struct {
	Type   string `json:"type"`
	RespId string `json:"reqid"`
	Error  string `json:"error,omitempty"`
}

func (*WriteFileReadyPacketType) GetType() string {
	return WriteFileReadyPacketStr
}

func (p *WriteFileReadyPacketType) GetResponseId() string {
	return p.RespId
}

func (p *WriteFileReadyPacketType) GetResponseDone() bool {
	return p.Error != ""
}

func MakeWriteFileReadyPacket(reqId string) *WriteFileReadyPacketType {
	return &WriteFileReadyPacketType{
		Type:   WriteFileReadyPacketStr,
		RespId: reqId,
	}
}

type WriteFileDonePacketType struct {
	Type   string `json:"type"`
	RespId string `json:"reqid"`
	Error  string `json:"error,omitempty"`
}

func (*WriteFileDonePacketType) GetType() string {
	return WriteFileDonePacketStr
}

func (p *WriteFileDonePacketType) GetResponseId() string {
	return p.RespId
}

func (p *WriteFileDonePacketType) GetResponseDone() bool {
	return true
}

func MakeWriteFileDonePacket(reqId string) *WriteFileDonePacketType {
	return &WriteFileDonePacketType{
		Type:   WriteFileDonePacketStr,
		RespId: reqId,
	}
}

type OpenAICmdInfoChatMessage struct {
	MessageID           int                            `json:"messageid"`
	IsAssistantResponse bool                           `json:"isassistantresponse,omitempty"`
	AssistantResponse   *OpenAICmdInfoPacketOutputType `json:"assistantresponse,omitempty"`
	UserQuery           string                         `json:"userquery,omitempty"`
	UserEngineeredQuery string                         `json:"userengineeredquery,omitempty"`
}

type OpenAIPromptMessageType struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}

type OpenAICloudReqPacketType struct {
	Type       string                    `json:"type"`
	ClientId   string                    `json:"clientid"`
	Prompt     []OpenAIPromptMessageType `json:"prompt"`
	MaxTokens  int                       `json:"maxtokens,omitempty"`
	MaxChoices int                       `json:"maxchoices,omitempty"`
}

func (*OpenAICloudReqPacketType) GetType() string {
	return OpenAICloudReqStr
}

func MakeOpenAICloudReqPacket() *OpenAICloudReqPacketType {
	return &OpenAICloudReqPacketType{
		Type: OpenAICloudReqStr,
	}
}

type PacketType interface {
	GetType() string
}

func AsString(pk PacketType) string {
	if pk == nil {
		return "nil"
	}
	if s, ok := pk.(fmt.Stringer); ok {
		return s.String()
	}
	return fmt.Sprintf("%s[]", pk.GetType())
}

type RpcPacketType interface {
	GetType() string
	GetReqId() string
}

type RpcResponsePacketType interface {
	GetType() string
	GetResponseId() string
	GetResponseDone() bool
}

type CommandPacketType interface {
	GetType() string
	GetCK() base.CommandKey
}

// RpcPackets initiate an Rpc.  these can be part of the data passed back and forth
type RpcFollowUpPacketType interface {
	GetType() string
	GetAssociatedReqId() string
}

type ModelUpdatePacketType struct {
	Type    string `json:"type"`
	Updates []any  `json:"updates"`
}

func AsExtType(pk PacketType) string {
	if rpcPacket, ok := pk.(RpcPacketType); ok {
		return fmt.Sprintf("%s[%s]", rpcPacket.GetType(), rpcPacket.GetReqId())
	} else if cmdPacket, ok := pk.(CommandPacketType); ok {
		return fmt.Sprintf("%s[%s]", cmdPacket.GetType(), cmdPacket.GetCK())
	} else {
		return pk.GetType()
	}
}

func ParseJsonPacket(jsonBuf []byte) (PacketType, error) {
	var bareCmd BarePacketType
	err := json.Unmarshal(jsonBuf, &bareCmd)
	if err != nil {
		return nil, err
	}
	if bareCmd.Type == "" {
		return nil, fmt.Errorf("received packet with no type")
	}
	pk, err := MakePacket(bareCmd.Type)
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal(jsonBuf, pk)
	if err != nil {
		return nil, fmt.Errorf("unmarshaling %q packet: %v", bareCmd.Type, err)
	}
	return pk, nil
}

type SendError struct {
	IsWriteError   bool // fatal
	IsMarshalError bool // not fatal
	PacketType     string
	Err            error
}

func (e *SendError) Unwrap() error {
	return e.Err
}

func (e *SendError) Error() string {
	if e.IsMarshalError {
		return fmt.Sprintf("SendPacket marshal-error '%s' packet: %v", e.PacketType, e.Err)
	} else if e.IsWriteError {
		return fmt.Sprintf("SendPacket write-error packet[%s]: %v", e.PacketType, e.Err)
	} else {
		return e.Err.Error()
	}
}

func MarshalPacket(packet PacketType) ([]byte, error) {
	if packet == nil {
		return nil, fmt.Errorf("invalid nil packet")
	}
	jsonBytes, err := json.Marshal(packet)
	if err != nil {
		return nil, &SendError{IsMarshalError: true, PacketType: packet.GetType(), Err: err}
	}
	var outBuf bytes.Buffer
	outBuf.WriteByte('\n')
	outBuf.WriteString(fmt.Sprintf("##%d", len(jsonBytes)))
	outBuf.Write(jsonBytes)
	outBuf.WriteByte('\n')
	outBytes := outBuf.Bytes()
	return outBytes, nil
}

func SendPacket(w io.Writer, packet PacketType) error {
	if packet == nil {
		return nil
	}
	outBytes, err := MarshalPacket(packet)
	if err != nil {
		return err
	}
	if GlobalDebug {
		base.Logf("SEND> %s\n", AsString(packet))
	}
	_, err = w.Write(outBytes)
	if err != nil {
		return &SendError{IsWriteError: true, PacketType: packet.GetType(), Err: err}
	}
	return nil
}

type PacketSender struct {
	Lock       *sync.Mutex
	SendCh     chan PacketType
	Done       bool
	DoneCh     chan bool
	ErrHandler func(*PacketSender, PacketType, error)
	ExitErr    error
}

func MakePacketSender(output io.Writer, errHandler func(*PacketSender, PacketType, error)) *PacketSender {
	sender := &PacketSender{
		Lock:       &sync.Mutex{},
		SendCh:     make(chan PacketType, PacketSenderQueueSize),
		DoneCh:     make(chan bool),
		ErrHandler: errHandler,
	}
	go func() {
		defer close(sender.DoneCh)
		defer sender.Close()
		for pk := range sender.SendCh {
			err := SendPacket(output, pk)
			if err != nil {
				sender.goHandleError(pk, err)
				if serr, ok := err.(*SendError); ok && serr.IsMarshalError {
					// marshaler errors are recoverable
					continue
				}
				// write errors are not recoverable
				sender.Lock.Lock()
				sender.ExitErr = err
				sender.Lock.Unlock()
				return
			}
		}
	}()
	return sender
}

func (sender *PacketSender) SendLogPacket(entry wlog.LogEntry) {
	sender.SendPacket(MakeLogPacket(entry))
}

func (sender *PacketSender) goHandleError(pk PacketType, err error) {
	sender.Lock.Lock()
	defer sender.Lock.Unlock()
	if sender.ErrHandler != nil {
		go sender.ErrHandler(sender, pk, err)
	}
}

func MakeChannelPacketSender(packetCh chan PacketType) *PacketSender {
	sender := &PacketSender{
		Lock:   &sync.Mutex{},
		SendCh: make(chan PacketType, PacketSenderQueueSize),
		DoneCh: make(chan bool),
	}
	go func() {
		defer close(sender.DoneCh)
		defer sender.Close()
		for pk := range sender.SendCh {
			packetCh <- pk
		}
	}()
	return sender
}

func (sender *PacketSender) Close() {
	sender.Lock.Lock()
	defer sender.Lock.Unlock()
	if sender.Done {
		return
	}
	sender.Done = true
	close(sender.SendCh)
}

// returns ExitErr if set
func (sender *PacketSender) WaitForDone() error {
	<-sender.DoneCh
	sender.Lock.Lock()
	defer sender.Lock.Unlock()
	return sender.ExitErr
}

// this is "advisory", as there is a race condition between the loop closing and setting Done.
// that's okay because that's an impossible race condition anyway (you could enqueue the packet
// and then the connection dies, or it dies half way, etc.).  this just stops blindly adding
// packets forever when the loop is done.
func (sender *PacketSender) checkStatus() error {
	sender.Lock.Lock()
	defer sender.Lock.Unlock()
	if sender.Done {
		return fmt.Errorf("cannot send packet, sender write loop is closed")
	}
	return nil
}

func (sender *PacketSender) SendPacketCtx(ctx context.Context, pk PacketType) error {
	err := sender.checkStatus()
	if err != nil {
		return err
	}
	select {
	case sender.SendCh <- pk:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (sender *PacketSender) SendPacket(pk PacketType) error {
	if pk == nil {
		log.Printf("tried to send nil packet\n")
		return fmt.Errorf("tried to send nil packet")
	}
	if pk.GetType() == "" {
		log.Printf("tried to send invalid packet: %T\n", pk)
		return fmt.Errorf("tried to send packet without a type: %T", pk)
	}
	err := sender.checkStatus()
	if err != nil {
		return err
	}
	sender.SendCh <- pk
	return nil
}

func (sender *PacketSender) SendErrorResponse(reqId string, err error) error {
	pk := MakeErrorResponsePacket(reqId, err)
	return sender.SendPacket(pk)
}

func (sender *PacketSender) SendResponse(reqId string, data interface{}) error {
	pk := MakeResponsePacket(reqId, data)
	return sender.SendPacket(pk)
}

func (sender *PacketSender) SendMessageFmt(fmtStr string, args ...interface{}) error {
	return sender.SendPacket(MakeMessagePacket(fmt.Sprintf(fmtStr, args...)))
}

type UnknownPacketReporter interface {
	UnknownPacket(pk PacketType)
}

type DefaultUPR struct{}

func (DefaultUPR) UnknownPacket(pk PacketType) {
	if pk.GetType() == RawPacketStr {
		rawPacket := pk.(*RawPacketType)
		fmt.Fprintf(os.Stderr, "%s\n", rawPacket.Data)
	} else if pk.GetType() == CmdStartPacketStr {
		return // do nothing
	} else {
		wlog.Logf("[upr] invalid packet received '%s'", AsExtType(pk))
	}
}

type MessageUPR struct {
	CK     base.CommandKey
	Sender *PacketSender
}

func (upr MessageUPR) UnknownPacket(pk PacketType) {
	msg := FmtMessagePacket("[error] invalid packet received %s", AsString(pk))
	msg.CK = upr.CK
	upr.Sender.SendPacket(msg)
}

// todo: clean hanging entries in RunMap when in server mode
type RunPacketBuilder struct {
	RunMap map[base.CommandKey]*RunPacketType
}

func MakeRunPacketBuilder() *RunPacketBuilder {
	return &RunPacketBuilder{
		RunMap: make(map[base.CommandKey]*RunPacketType),
	}
}

// returns (consumed, fullRunPacket)
func (b *RunPacketBuilder) ProcessPacket(pk PacketType) (bool, *RunPacketType) {
	if pk.GetType() == RunPacketStr {
		runPacket := pk.(*RunPacketType)
		if len(runPacket.RunData) == 0 {
			return true, runPacket
		}
		b.RunMap[runPacket.CK] = runPacket
		return true, nil
	}
	if pk.GetType() == DataEndPacketStr {
		endPacket := pk.(*DataEndPacketType)
		runPacket := b.RunMap[endPacket.CK] // might be nil
		delete(b.RunMap, endPacket.CK)
		return true, runPacket
	}
	if pk.GetType() == DataPacketStr {
		dataPacket := pk.(*DataPacketType)
		runPacket := b.RunMap[dataPacket.CK]
		if runPacket == nil {
			return false, nil
		}
		for idx, runData := range runPacket.RunData {
			if runData.FdNum == dataPacket.FdNum {
				// can ignore error, will get caught later with RunData.DataLen check
				realData, _ := base64.StdEncoding.DecodeString(dataPacket.Data64)
				runData.Data = append(runData.Data, realData...)
				runPacket.RunData[idx] = runData
				break
			}
		}
		return true, nil
	}
	return false, nil
}
