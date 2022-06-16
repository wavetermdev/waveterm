// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package packet

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strconv"
	"strings"
	"sync"
)

const RunPacketStr = "run"
const PingPacketStr = "ping"
const DonePacketStr = "done"
const ErrorPacketStr = "error"
const MessagePacketStr = "message"
const CmdStartPacketStr = "cmdstart"
const CmdDonePacketStr = "cmddone"
const ListCmdPacketStr = "lscmd"
const GetCmdPacketStr = "getcmd"
const RunnerInitPacketStr = "runnerinit"
const CdPacketStr = "cd"
const CdResponseStr = "cdresp"
const CmdDataPacketStr = "cmddata"
const RawPacketStr = "raw"

var TypeStrToFactory map[string]reflect.Type

func init() {
	TypeStrToFactory = make(map[string]reflect.Type)
	TypeStrToFactory[RunPacketStr] = reflect.TypeOf(RunPacketType{})
	TypeStrToFactory[PingPacketStr] = reflect.TypeOf(PingPacketType{})
	TypeStrToFactory[DonePacketStr] = reflect.TypeOf(DonePacketType{})
	TypeStrToFactory[ErrorPacketStr] = reflect.TypeOf(ErrorPacketType{})
	TypeStrToFactory[MessagePacketStr] = reflect.TypeOf(MessagePacketType{})
	TypeStrToFactory[CmdStartPacketStr] = reflect.TypeOf(CmdStartPacketType{})
	TypeStrToFactory[CmdDonePacketStr] = reflect.TypeOf(CmdDonePacketType{})
	TypeStrToFactory[ListCmdPacketStr] = reflect.TypeOf(ListCmdPacketType{})
	TypeStrToFactory[GetCmdPacketStr] = reflect.TypeOf(GetCmdPacketType{})
	TypeStrToFactory[RunnerInitPacketStr] = reflect.TypeOf(RunnerInitPacketType{})
	TypeStrToFactory[CdPacketStr] = reflect.TypeOf(CdPacketType{})
	TypeStrToFactory[CdResponseStr] = reflect.TypeOf(CdResponseType{})
	TypeStrToFactory[CmdDataPacketStr] = reflect.TypeOf(CmdDataPacketType{})
	TypeStrToFactory[RawPacketStr] = reflect.TypeOf(RawPacketType{})
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
	Type      string `json:"type"`
	SessionId string `json:"sessionid"`
	CmdId     string `json:"cmdid"`
	PtyPos    int64  `json:"ptypos"`
	PtyLen    int64  `json:"ptylen"`
	RunPos    int64  `json:"runpos"`
	RunLen    int64  `json:"runlen"`
	PtyData   string `json:"ptydata"`
	RunData   string `json:"rundata"`
	Error     string `json:"error"`
	NotFound  bool   `json:"notfound,omitempty"`
}

func (*CmdDataPacketType) GetType() string {
	return CmdDataPacketStr
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

type GetCmdPacketType struct {
	Type      string `json:"type"`
	SessionId string `json:"sessionid"`
	CmdId     string `json:"cmdid"`
	PtyPos    int64  `json:"ptypos"`
	RunPos    int64  `json:"runpos"`
	Tail      bool   `json:"tail,omitempty"`
}

func (*GetCmdPacketType) GetType() string {
	return GetCmdPacketStr
}

func MakeGetCmdPacket() *GetCmdPacketType {
	return &GetCmdPacketType{Type: GetCmdPacketStr}
}

type ListCmdPacketType struct {
	Type      string `json:"type"`
	SessionId string `json:"sessionid"`
}

func (*ListCmdPacketType) GetType() string {
	return ListCmdPacketStr
}

func MakeListCmdPacket(sessionId string) *ListCmdPacketType {
	return &ListCmdPacketType{Type: ListCmdPacketStr, SessionId: sessionId}
}

type CdPacketType struct {
	Type     string `json:"type"`
	PacketId string `json:"packetid"`
	Dir      string `json:"dir"`
}

func (*CdPacketType) GetType() string {
	return CdPacketStr
}

func MakeCdPacket() *CdPacketType {
	return &CdPacketType{Type: CdPacketStr}
}

type CdResponseType struct {
	Type     string `json:"type"`
	PacketId string `json:"packetid"`
	Success  bool   `json:"success"`
	Error    string `json:"error"`
}

func (*CdResponseType) GetType() string {
	return CdResponseStr
}

func MakeCdResponse() *CdResponseType {
	return &CdResponseType{Type: CdResponseStr}
}

type RawPacketType struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

func (*RawPacketType) GetType() string {
	return RawPacketStr
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

func MakeMessagePacket(message string) *MessagePacketType {
	return &MessagePacketType{Type: MessagePacketStr, Message: message}
}

func FmtMessagePacket(fmtStr string, args ...interface{}) *MessagePacketType {
	message := fmt.Sprintf(fmtStr, args...)
	return &MessagePacketType{Type: MessagePacketStr, Message: message}
}

type RunnerInitPacketType struct {
	Type      string   `json:"type"`
	ScHomeDir string   `json:"schomedir"`
	HomeDir   string   `json:"homedir"`
	Env       []string `json:"env"`
}

func (*RunnerInitPacketType) GetType() string {
	return RunnerInitPacketStr
}

func MakeRunnerInitPacket() *RunnerInitPacketType {
	return &RunnerInitPacketType{Type: RunnerInitPacketStr}
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
	Type       string `json:"type"`
	Ts         int64  `json:"ts"`
	CmdId      string `json:"cmdid"`
	ExitCode   int    `json:"exitcode"`
	DurationMs int64  `json:"durationms"`
}

func (*CmdDonePacketType) GetType() string {
	return CmdDonePacketStr
}

func MakeCmdDonePacket() *CmdDonePacketType {
	return &CmdDonePacketType{Type: CmdDonePacketStr}
}

type CmdStartPacketType struct {
	Type      string `json:"type"`
	Ts        int64  `json:"ts"`
	CmdId     string `json:"cmdid"`
	Pid       int    `json:"pid"`
	RunnerPid int    `json:"runnerpid"`
}

func (*CmdStartPacketType) GetType() string {
	return CmdStartPacketStr
}

func MakeCmdStartPacket() *CmdStartPacketType {
	return &CmdStartPacketType{Type: CmdStartPacketStr}
}

type RunPacketType struct {
	Type      string            `json:"type"`
	SessionId string            `json:"sessionid"`
	CmdId     string            `json:"cmdid"`
	ChDir     string            `json:"chdir,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Command   string            `json:"command"`
}

func (ct *RunPacketType) GetType() string {
	return RunPacketStr
}

func MakeRunPacket() *RunPacketType {
	return &RunPacketType{Type: RunPacketStr}
}

type BarePacketType struct {
	Type string `json:"type"`
}

type ErrorPacketType struct {
	Id    string `json:"id,omitempty"`
	Type  string `json:"type"`
	Error string `json:"error"`
}

func (et *ErrorPacketType) GetType() string {
	return ErrorPacketStr
}

func MakeErrorPacket(errorStr string) *ErrorPacketType {
	return &ErrorPacketType{Type: ErrorPacketStr, Error: errorStr}
}

func MakeIdErrorPacket(id string, errorStr string) *ErrorPacketType {
	return &ErrorPacketType{Type: ErrorPacketStr, Id: id, Error: errorStr}
}

type PacketType interface {
	GetType() string
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
		SendCh: make(chan PacketType),
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

func PacketParser(input io.Reader) chan PacketType {
	bufReader := bufio.NewReader(input)
	rtnCh := make(chan PacketType)
	go func() {
		defer func() {
			close(rtnCh)
		}()
		for {
			line, err := bufReader.ReadString('\n')
			if err == io.EOF {
				return
			}
			if err != nil {
				errPacket := MakeErrorPacket(fmt.Sprintf("reading packets from input: %v", err))
				rtnCh <- errPacket
				return
			}
			if line == "\n" {
				continue
			}
			// ##[len][json]\n
			// ##14{"hello":true}\n
			bracePos := strings.Index(line, "{")
			if !strings.HasPrefix(line, "##") || bracePos == -1 {
				rtnCh <- MakeRawPacket(line[:len(line)-1])
				continue
			}
			packetLen, err := strconv.Atoi(line[2:bracePos])
			if err != nil || packetLen != len(line)-bracePos-1 {
				rtnCh <- MakeRawPacket(line[:len(line)-1])
				continue
			}
			pk, err := ParseJsonPacket([]byte(line[bracePos:]))
			if err != nil {
				errPk := MakeErrorPacket(fmt.Sprintf("parsing packet json from input: %v", err))
				rtnCh <- errPk
				return
			}
			if pk.GetType() == DonePacketStr {
				return
			}
			rtnCh <- pk
		}
	}()
	return rtnCh
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
