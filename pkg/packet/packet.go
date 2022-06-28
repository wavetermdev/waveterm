// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package packet

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"sync"

	"github.com/scripthaus-dev/mshell/pkg/base"
)

// remote: init, run, ping, data, cmdstart, cmddone
// remote(detached): init, run, cmdstart
// server: init, run, ping, cmdstart, cmddone, cd, resp, getcmd, untailcmd, cmddata, input, data, [comp]
// all: error, message

var GlobalDebug = false

const (
	RunPacketStr       = "run"
	PingPacketStr      = "ping"
	InitPacketStr      = "init"
	DataPacketStr      = "data"
	DataAckPacketStr   = "dataack"
	CmdStartPacketStr  = "cmdstart"
	CmdDonePacketStr   = "cmddone"
	ResponsePacketStr  = "resp"
	DonePacketStr      = "done"
	ErrorPacketStr     = "error"
	MessagePacketStr   = "message"
	GetCmdPacketStr    = "getcmd"
	UntailCmdPacketStr = "untailcmd"
	CdPacketStr        = "cd"
	CmdDataPacketStr   = "cmddata"
	RawPacketStr       = "raw"
	InputPacketStr     = "input"
)

const PacketSenderQueueSize = 20

var TypeStrToFactory map[string]reflect.Type

func init() {
	TypeStrToFactory = make(map[string]reflect.Type)
	TypeStrToFactory[RunPacketStr] = reflect.TypeOf(RunPacketType{})
	TypeStrToFactory[PingPacketStr] = reflect.TypeOf(PingPacketType{})
	TypeStrToFactory[ResponsePacketStr] = reflect.TypeOf(ResponsePacketType{})
	TypeStrToFactory[DonePacketStr] = reflect.TypeOf(DonePacketType{})
	TypeStrToFactory[ErrorPacketStr] = reflect.TypeOf(ErrorPacketType{})
	TypeStrToFactory[MessagePacketStr] = reflect.TypeOf(MessagePacketType{})
	TypeStrToFactory[CmdStartPacketStr] = reflect.TypeOf(CmdStartPacketType{})
	TypeStrToFactory[CmdDonePacketStr] = reflect.TypeOf(CmdDonePacketType{})
	TypeStrToFactory[GetCmdPacketStr] = reflect.TypeOf(GetCmdPacketType{})
	TypeStrToFactory[UntailCmdPacketStr] = reflect.TypeOf(UntailCmdPacketType{})
	TypeStrToFactory[InitPacketStr] = reflect.TypeOf(InitPacketType{})
	TypeStrToFactory[CdPacketStr] = reflect.TypeOf(CdPacketType{})
	TypeStrToFactory[CmdDataPacketStr] = reflect.TypeOf(CmdDataPacketType{})
	TypeStrToFactory[RawPacketStr] = reflect.TypeOf(RawPacketType{})
	TypeStrToFactory[InputPacketStr] = reflect.TypeOf(InputPacketType{})
	TypeStrToFactory[DataPacketStr] = reflect.TypeOf(DataPacketType{})
	TypeStrToFactory[DataAckPacketStr] = reflect.TypeOf(DataAckPacketType{})
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
	ReqId      string          `json:"reqid"`
	CK         base.CommandKey `json:"ck"`
	PtyPos     int64           `json:"ptypos"`
	PtyLen     int64           `json:"ptylen"`
	RunPos     int64           `json:"runpos"`
	RunLen     int64           `json:"runlen"`
	PtyData    string          `json:"ptydata"`
	PtyDataLen int             `json:"ptydatalen"`
	RunData    string          `json:"rundata"`
	RunDataLen int             `json:"rundatalen"`
	Error      string          `json:"error"`
	NotFound   bool            `json:"notfound,omitempty"`
}

func (*CmdDataPacketType) GetType() string {
	return CmdDataPacketStr
}

func (p *CmdDataPacketType) GetCK() base.CommandKey {
	return p.CK
}

func MakeCmdDataPacket() *CmdDataPacketType {
	return &CmdDataPacketType{Type: CmdDataPacketStr}
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

// InputData gets written to PTY directly
// SigNum gets sent to process via a signal
// WinSize, if set, will run TIOCSWINSZ to set size, and then send SIGWINCH
type InputPacketType struct {
	Type        string          `json:"type"`
	CK          base.CommandKey `json:"ck"`
	InputData   string          `json:"inputdata"`
	SigNum      int             `json:"signum,omitempty"`
	WinSizeRows int             `json:"winsizerows"`
	WinSizeCols int             `json:"winsizecols"`
}

func (*InputPacketType) GetType() string {
	return InputPacketStr
}

func (p *InputPacketType) GetCK() base.CommandKey {
	return p.CK
}

func MakeInputPacket() *InputPacketType {
	return &InputPacketType{Type: InputPacketStr}
}

type UntailCmdPacketType struct {
	Type  string          `json:"type"`
	ReqId string          `json:"reqid"`
	CK    base.CommandKey `json:"ck"`
}

func (*UntailCmdPacketType) GetType() string {
	return UntailCmdPacketStr
}

func (p *UntailCmdPacketType) GetCK() base.CommandKey {
	return p.CK
}

func MakeUntailCmdPacket() *UntailCmdPacketType {
	return &UntailCmdPacketType{Type: UntailCmdPacketStr}
}

type GetCmdPacketType struct {
	Type   string          `json:"type"`
	ReqId  string          `json:"reqid"`
	CK     base.CommandKey `json:"ck"`
	PtyPos int64           `json:"ptypos"`
	RunPos int64           `json:"runpos"`
	Tail   bool            `json:"tail,omitempty"`
}

func (*GetCmdPacketType) GetType() string {
	return GetCmdPacketStr
}

func (p *GetCmdPacketType) GetCK() base.CommandKey {
	return p.CK
}

func MakeGetCmdPacket() *GetCmdPacketType {
	return &GetCmdPacketType{Type: GetCmdPacketStr}
}

type CdPacketType struct {
	Type     string `json:"type"`
	PacketId string `json:"packetid"`
	Dir      string `json:"dir"`
}

func (*CdPacketType) GetType() string {
	return CdPacketStr
}

func (p *CdPacketType) GetPacketId() string {
	return p.PacketId
}

func MakeCdPacket() *CdPacketType {
	return &CdPacketType{Type: CdPacketStr}
}

type ResponsePacketType struct {
	Type     string      `json:"type"`
	PacketId string      `json:"packetid"`
	Success  bool        `json:"success"`
	Error    string      `json:"error"`
	Data     interface{} `json:"data"`
}

func (*ResponsePacketType) GetType() string {
	return ResponsePacketStr
}

func (p *ResponsePacketType) GetPacketId() string {
	return p.PacketId
}

func MakeResponsePacket(packetId string) *ResponsePacketType {
	return &ResponsePacketType{Type: ResponsePacketStr, PacketId: packetId}
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
	Type    string `json:"type"`
	Message string `json:"message"`
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
	Type      string   `json:"type"`
	Version   string   `json:"version"`
	ScHomeDir string   `json:"schomedir,omitempty"`
	HomeDir   string   `json:"homedir,omitempty"`
	Env       []string `json:"env,omitempty"`
	User      string   `json:"user,omitempty"`
	NotFound  bool     `json:"notfound,omitempty"`
	UName     string   `json:"uname,omitempty"`
}

func (*InitPacketType) GetType() string {
	return InitPacketStr
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

type CmdDonePacketType struct {
	Type       string          `json:"type"`
	Ts         int64           `json:"ts"`
	CK         base.CommandKey `json:"ck"`
	ExitCode   int             `json:"exitcode"`
	DurationMs int64           `json:"durationms"`
}

func (*CmdDonePacketType) GetType() string {
	return CmdDonePacketStr
}

func (p *CmdDonePacketType) GetCK() base.CommandKey {
	return p.CK
}

func MakeCmdDonePacket() *CmdDonePacketType {
	return &CmdDonePacketType{Type: CmdDonePacketStr}
}

type CmdStartPacketType struct {
	Type      string          `json:"type"`
	Ts        int64           `json:"ts"`
	CK        base.CommandKey `json:"ck"`
	Pid       int             `json:"pid"`
	MShellPid int             `json:"mshellpid"`
}

func (*CmdStartPacketType) GetType() string {
	return CmdStartPacketStr
}

func (p *CmdStartPacketType) GetCK() base.CommandKey {
	return p.CK
}

func MakeCmdStartPacket() *CmdStartPacketType {
	return &CmdStartPacketType{Type: CmdStartPacketStr}
}

type TermSize struct {
	Rows int `json:"rows"`
	Cols int `json:"cols"`
}

type RemoteFd struct {
	FdNum    int    `json:"fdnum"`
	Read     bool   `json:"read"`
	Write    bool   `json:"write"`
	Content  string `json:"-"`
	DupStdin bool   `json:"-"`
}

type RunPacketType struct {
	Type     string            `json:"type"`
	CK       base.CommandKey   `json:"ck"`
	Command  string            `json:"command"`
	Cwd      string            `json:"cwd,omitempty"`
	Env      map[string]string `json:"env,omitempty"`
	TermSize *TermSize         `json:"termsize,omitempty"`
	Fds      []RemoteFd        `json:"fds,omitempty"`
	Detached bool              `json:"detached,omitempty"`
}

func (*RunPacketType) GetType() string {
	return RunPacketStr
}

func (p *RunPacketType) GetCK() base.CommandKey {
	return p.CK
}

func MakeRunPacket() *RunPacketType {
	return &RunPacketType{Type: RunPacketStr}
}

type BarePacketType struct {
	Type string `json:"type"`
}

type ErrorPacketType struct {
	CK    base.CommandKey `json:"ck,omitempty"`
	Type  string          `json:"type"`
	Error string          `json:"error"`
}

func (et *ErrorPacketType) GetType() string {
	return ErrorPacketStr
}

func MakeErrorPacket(errorStr string) *ErrorPacketType {
	return &ErrorPacketType{Type: ErrorPacketStr, Error: errorStr}
}

func MakeCKErrorPacket(ck base.CommandKey, errorStr string) *ErrorPacketType {
	return &ErrorPacketType{Type: ErrorPacketStr, CK: ck, Error: errorStr}
}

type PacketType interface {
	GetType() string
}

func AsString(pk PacketType) string {
	if s, ok := pk.(fmt.Stringer); ok {
		return s.String()
	}
	return fmt.Sprintf("%s[]", pk.GetType())
}

type RpcPacketType interface {
	GetType() string
	GetPacketId() string
}

type CommandPacketType interface {
	GetType() string
	GetCK() base.CommandKey
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
		return nil, err
	}
	return pk, nil
}

func SendPacket(w io.Writer, packet PacketType) error {
	if packet == nil {
		return nil
	}
	jsonBytes, err := json.Marshal(packet)
	if err != nil {
		return fmt.Errorf("marshaling '%s' packet: %w", packet.GetType(), err)
	}
	var outBuf bytes.Buffer
	outBuf.WriteByte('\n')
	outBuf.WriteString(fmt.Sprintf("##%d", len(jsonBytes)))
	outBuf.Write(jsonBytes)
	outBuf.WriteByte('\n')
	if GlobalDebug {
		fmt.Printf("SEND> %s\n", AsString(packet))
	}
	_, err = w.Write(outBuf.Bytes())
	if err != nil {
		return err
	}
	return nil
}

func SendErrorPacket(w io.Writer, errorStr string) error {
	return SendPacket(w, MakeErrorPacket(errorStr))
}

type PacketSender struct {
	Lock   *sync.Mutex
	SendCh chan PacketType
	Err    error
	Done   bool
	DoneCh chan bool
}

func MakePacketSender(output io.Writer) *PacketSender {
	sender := &PacketSender{
		Lock:   &sync.Mutex{},
		SendCh: make(chan PacketType, PacketSenderQueueSize),
		DoneCh: make(chan bool),
	}
	go func() {
		defer func() {
			sender.Lock.Lock()
			sender.Done = true
			sender.Lock.Unlock()
			close(sender.DoneCh)
		}()
		for pk := range sender.SendCh {
			err := SendPacket(output, pk)
			if err != nil {
				sender.Lock.Lock()
				sender.Err = err
				sender.Lock.Unlock()
				return
			}
		}
	}()
	return sender
}

func (sender *PacketSender) CloseSendCh() {
	close(sender.SendCh)
}

func (sender *PacketSender) WaitForDone() {
	<-sender.DoneCh
}

func (sender *PacketSender) checkStatus() error {
	sender.Lock.Lock()
	defer sender.Lock.Unlock()
	if sender.Done {
		return fmt.Errorf("cannot send packet, sender write loop is closed")
	}
	if sender.Err != nil {
		return fmt.Errorf("cannot send packet, sender had error: %w", sender.Err)
	}
	return nil
}

func (sender *PacketSender) SendPacket(pk PacketType) error {
	err := sender.checkStatus()
	if err != nil {
		return err
	}
	sender.SendCh <- pk
	return nil
}

func (sender *PacketSender) SendErrorPacket(errVal string) error {
	return sender.SendPacket(MakeErrorPacket(errVal))
}

func (sender *PacketSender) SendMessage(fmtStr string, args ...interface{}) error {
	return sender.SendPacket(MakeMessagePacket(fmt.Sprintf(fmtStr, args...)))
}

type ErrorReporter interface {
	ReportError(err error)
}

func PacketToByteArrBridge(pkCh chan PacketType, byteCh chan []byte, errorReporter ErrorReporter, closeOnDone bool) {
	go func() {
		defer func() {
			if closeOnDone {
				close(byteCh)
			}
		}()
		for pk := range pkCh {
			if pk == nil {
				continue
			}
			jsonBytes, err := json.Marshal(pk)
			if err != nil {
				if errorReporter != nil {
					errorReporter.ReportError(fmt.Errorf("error marshaling packet: %w", err))
				}
				continue
			}
			byteCh <- jsonBytes
		}
	}()
}
