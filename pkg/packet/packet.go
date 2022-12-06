// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package packet

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"reflect"
	"sync"

	"github.com/scripthaus-dev/mshell/pkg/base"
)

// single          : <init, >run, >cmddata, >cmddone, <cmdstart, <>data, <>dataack, <cmddone
// single(detached): <init, >run, >cmddata, >cmddone, <cmdstart
// server          : <init, >run, >cmddata, >cmddone, <cmdstart, <>data, <>dataack, <cmddone
//                   >cd, >getcmd, >untailcmd, >input, <resp
// all             : <>error, <>message, <>ping, <raw

const MaxCompGenValues = 100

var GlobalDebug = false

const (
	RunPacketStr          = "run" // rpc
	PingPacketStr         = "ping"
	InitPacketStr         = "init"
	DataPacketStr         = "data"     // command
	DataAckPacketStr      = "dataack"  // command
	CmdStartPacketStr     = "cmdstart" // rpc-response
	CmdDonePacketStr      = "cmddone"  // command
	DataEndPacketStr      = "dataend"
	ResponsePacketStr     = "resp" // rpc-response
	DonePacketStr         = "done"
	CmdErrorPacketStr     = "cmderror" // command
	MessagePacketStr      = "message"
	GetCmdPacketStr       = "getcmd"    // rpc
	UntailCmdPacketStr    = "untailcmd" // rpc
	CdPacketStr           = "cd"        // rpc
	CmdDataPacketStr      = "cmddata"   // rpc-response
	RawPacketStr          = "raw"
	SpecialInputPacketStr = "sinput"   // command
	CompGenPacketStr      = "compgen"  // rpc
	ReInitPacketStr       = "reinit"   // rpc
	CmdFinalPacketStr     = "cmdfinal" // command, pushed at the "end" of a command (fail-safe for no cmddone)
)

const PacketSenderQueueSize = 20

var TypeStrToFactory map[string]reflect.Type

func init() {
	TypeStrToFactory = make(map[string]reflect.Type)
	TypeStrToFactory[RunPacketStr] = reflect.TypeOf(RunPacketType{})
	TypeStrToFactory[PingPacketStr] = reflect.TypeOf(PingPacketType{})
	TypeStrToFactory[ResponsePacketStr] = reflect.TypeOf(ResponsePacketType{})
	TypeStrToFactory[DonePacketStr] = reflect.TypeOf(DonePacketType{})
	TypeStrToFactory[CmdErrorPacketStr] = reflect.TypeOf(CmdErrorPacketType{})
	TypeStrToFactory[MessagePacketStr] = reflect.TypeOf(MessagePacketType{})
	TypeStrToFactory[CmdStartPacketStr] = reflect.TypeOf(CmdStartPacketType{})
	TypeStrToFactory[CmdDonePacketStr] = reflect.TypeOf(CmdDonePacketType{})
	TypeStrToFactory[GetCmdPacketStr] = reflect.TypeOf(GetCmdPacketType{})
	TypeStrToFactory[UntailCmdPacketStr] = reflect.TypeOf(UntailCmdPacketType{})
	TypeStrToFactory[InitPacketStr] = reflect.TypeOf(InitPacketType{})
	TypeStrToFactory[CdPacketStr] = reflect.TypeOf(CdPacketType{})
	TypeStrToFactory[CmdDataPacketStr] = reflect.TypeOf(CmdDataPacketType{})
	TypeStrToFactory[RawPacketStr] = reflect.TypeOf(RawPacketType{})
	TypeStrToFactory[SpecialInputPacketStr] = reflect.TypeOf(SpecialInputPacketType{})
	TypeStrToFactory[DataPacketStr] = reflect.TypeOf(DataPacketType{})
	TypeStrToFactory[DataAckPacketStr] = reflect.TypeOf(DataAckPacketType{})
	TypeStrToFactory[DataEndPacketStr] = reflect.TypeOf(DataEndPacketType{})
	TypeStrToFactory[CompGenPacketStr] = reflect.TypeOf(CompGenPacketType{})
	TypeStrToFactory[ReInitPacketStr] = reflect.TypeOf(ReInitPacketType{})
	TypeStrToFactory[CmdFinalPacketStr] = reflect.TypeOf(CmdFinalPacketType{})

	var _ RpcPacketType = (*RunPacketType)(nil)
	var _ RpcPacketType = (*GetCmdPacketType)(nil)
	var _ RpcPacketType = (*UntailCmdPacketType)(nil)
	var _ RpcPacketType = (*CdPacketType)(nil)
	var _ RpcPacketType = (*CompGenPacketType)(nil)
	var _ RpcPacketType = (*ReInitPacketType)(nil)

	var _ RpcResponsePacketType = (*CmdStartPacketType)(nil)
	var _ RpcResponsePacketType = (*ResponsePacketType)(nil)
	var _ RpcResponsePacketType = (*CmdDataPacketType)(nil)

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

type CmdDataPacketType struct {
	Type       string          `json:"type"`
	RespId     string          `json:"respid"`
	CK         base.CommandKey `json:"ck"`
	PtyPos     int64           `json:"ptypos"`
	PtyLen     int64           `json:"ptylen"`
	RunPos     int64           `json:"runpos"`
	RunLen     int64           `json:"runlen"`
	PtyData64  string          `json:"ptydata64"`
	PtyDataLen int             `json:"ptydatalen"`
	RunData64  string          `json:"rundata64"`
	RunDataLen int             `json:"rundatalen"`
}

func (*CmdDataPacketType) GetType() string {
	return CmdDataPacketStr
}

func (p *CmdDataPacketType) GetResponseId() string {
	return p.RespId
}

func (*CmdDataPacketType) GetResponseDone() bool {
	return false
}

func MakeCmdDataPacket(reqId string) *CmdDataPacketType {
	return &CmdDataPacketType{Type: CmdDataPacketStr, RespId: reqId}
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
	SigName string          `json:"signame,omitempty"` // passed to unix.SignalNum (needs 'SIG' prefix, e.g. "SIGTERM")
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
	Type  string `json:"type"`
	ReqId string `json:"reqid"`
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
	Type    string      `json:"type"`
	RespId  string      `json:"respid"`
	Success bool        `json:"success"`
	Error   string      `json:"error,omitempty"`
	Data    interface{} `json:"data,omitempty"`
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
	Type          string      `json:"type"`
	RespId        string      `json:"respid,omitempty"`
	Version       string      `json:"version"`
	MShellHomeDir string      `json:"mshellhomedir,omitempty"`
	HomeDir       string      `json:"homedir,omitempty"`
	State         *ShellState `json:"state,omitempty"`
	User          string      `json:"user,omitempty"`
	HostName      string      `json:"hostname,omitempty"`
	NotFound      bool        `json:"notfound,omitempty"`
	UName         string      `json:"uname,omitempty"`
	RemoteId      string      `json:"remoteid,omitempty"`
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
	RespId    string          `json:"respid"`
	Ts        int64           `json:"ts"`
	CK        base.CommandKey `json:"ck"`
	Pid       int             `json:"pid"`
	MShellPid int             `json:"mshellpid"`
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

type RunPacketType struct {
	Type          string          `json:"type"`
	ReqId         string          `json:"reqid"`
	CK            base.CommandKey `json:"ck"`
	Command       string          `json:"command"`
	State         *ShellState     `json:"state,omitempty"`
	StateDiff     *ShellStateDiff `json:"statediff,omitempty"`
	StateComplete bool            `json:"statecomplete,omitempty"` // set to true if state is complete (the default env should not be set)
	UsePty        bool            `json:"usepty,omitempty"`
	TermOpts      *TermOpts       `json:"termopts,omitempty"`
	Fds           []RemoteFd      `json:"fds,omitempty"`
	RunData       []RunDataType   `json:"rundata,omitempty"`
	Detached      bool            `json:"detached,omitempty"`
	ReturnState   bool            `json:"returnstate,omitempty"`
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

type BarePacketType struct {
	Type string `json:"type"`
}

type CmdErrorPacketType struct {
	Type  string          `json:"type"`
	CK    base.CommandKey `json:"ck"`
	Error string          `json:"error"`
}

func (*CmdErrorPacketType) GetType() string {
	return CmdErrorPacketStr
}

func (p *CmdErrorPacketType) GetCK() base.CommandKey {
	return p.CK
}

func (p *CmdErrorPacketType) String() string {
	return fmt.Sprintf("error[%s]", p.Error)
}

func MakeCmdErrorPacket(ck base.CommandKey, err error) *CmdErrorPacketType {
	return &CmdErrorPacketType{Type: CmdErrorPacketStr, CK: ck, Error: err.Error()}
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

func sanitizeBytes(buf []byte) {
	for idx, b := range buf {
		if b >= 127 || (b < 32 && b != 10 && b != 13) {
			buf[idx] = '?'
		}
	}
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

func SendPacket(w io.Writer, packet PacketType) error {
	if packet == nil {
		return nil
	}
	jsonBytes, err := json.Marshal(packet)
	if err != nil {
		return &SendError{IsMarshalError: true, PacketType: packet.GetType(), Err: err}
	}
	var outBuf bytes.Buffer
	outBuf.WriteByte('\n')
	outBuf.WriteString(fmt.Sprintf("##%d", len(jsonBytes)))
	outBuf.Write(jsonBytes)
	outBuf.WriteByte('\n')
	if GlobalDebug {
		base.Logf("SEND> %s\n", AsString(packet))
	}
	outBytes := outBuf.Bytes()
	sanitizeBytes(outBytes)
	_, err = w.Write(outBytes)
	if err != nil {
		return &SendError{IsWriteError: true, PacketType: packet.GetType(), Err: err}
	}
	return nil
}

func SendCmdError(w io.Writer, ck base.CommandKey, err error) error {
	return SendPacket(w, MakeCmdErrorPacket(ck, err))
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
	err := sender.checkStatus()
	if err != nil {
		return err
	}
	sender.SendCh <- pk
	return nil
}

func (sender *PacketSender) SendCmdError(ck base.CommandKey, err error) error {
	return sender.SendPacket(MakeCmdErrorPacket(ck, err))
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
	if pk.GetType() == CmdErrorPacketStr {
		errPacket := pk.(*CmdErrorPacketType)
		// at this point, just send the error packet to stderr rather than try to do something special
		fmt.Fprintf(os.Stderr, "[error] %s\n", errPacket.Error)
	} else if pk.GetType() == RawPacketStr {
		rawPacket := pk.(*RawPacketType)
		fmt.Fprintf(os.Stderr, "%s\n", rawPacket.Data)
	} else if pk.GetType() == CmdStartPacketStr {
		return // do nothing
	} else {
		fmt.Fprintf(os.Stderr, "[error] invalid packet received '%s'", AsExtType(pk))
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
