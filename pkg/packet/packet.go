// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package packet

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"sync"
)

const RunPacketStr = "run"
const PingPacketStr = "ping"
const DonePacketStr = "done"
const ErrorPacketStr = "error"
const MessagePacketStr = "message"
const CmdStartPacketStr = "cmdstart"
const CmdDonePacketStr = "cmddone"

type PingPacketType struct {
	Type string `json:"type"`
}

func (*PingPacketType) GetType() string {
	return PingPacketStr
}

func MakePingPacket() *PingPacketType {
	return &PingPacketType{Type: PingPacketStr}
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
	if bareCmd.Type == RunPacketStr {
		var runPacket RunPacketType
		err = json.Unmarshal(jsonBuf, &runPacket)
		if err != nil {
			return nil, err
		}
		return &runPacket, nil
	}
	if bareCmd.Type == PingPacketStr {
		return MakePingPacket(), nil
	}
	if bareCmd.Type == DonePacketStr {
		return MakeDonePacket(), nil
	}
	if bareCmd.Type == ErrorPacketStr {
		var errorPacket ErrorPacketType
		err = json.Unmarshal(jsonBuf, &errorPacket)
		if err != nil {
			return nil, err
		}
		return &errorPacket, nil
	}
	if bareCmd.Type == CmdStartPacketStr {
		var startPacket CmdStartPacketType
		err = json.Unmarshal(jsonBuf, &startPacket)
		if err != nil {
			return nil, err
		}
		return &startPacket, nil
	}
	if bareCmd.Type == CmdDonePacketStr {
		var donePacket CmdDonePacketType
		err = json.Unmarshal(jsonBuf, &donePacket)
		if err != nil {
			return nil, err
		}
		return &donePacket, nil
	}
	return nil, fmt.Errorf("invalid packet-type '%s'", bareCmd.Type)
}

func SendPacket(w io.Writer, packet PacketType) error {
	if packet == nil {
		return nil
	}
	barr, err := json.Marshal(packet)
	if err != nil {
		return fmt.Errorf("marshaling '%s' packet: %w", packet.GetType(), err)
	}
	barr = append(barr, '\n')
	_, err = w.Write(barr)
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
			pk, err := ParseJsonPacket([]byte(line))
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
