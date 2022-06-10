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
)

const RunPacketStr = "run"
const PingPacketStr = "ping"
const DonePacketStr = "done"
const ErrorPacketStr = "error"
const OkCmdPacketStr = "okcmd"

type PingPacketType struct {
	Type string `json:"type"`
}

func (*PingPacketType) GetType() string {
	return PingPacketStr
}

func MakePingPacket() *PingPacketType {
	return &PingPacketType{Type: PingPacketStr}
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

type OkCmdPacketType struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	CmdId   string `json:"cmdid"`
	Pid     int    `json:"pid"`
}

func (*OkCmdPacketType) GetType() string {
	return OkCmdPacketStr
}

func MakeOkCmdPacket(message string, cmdId string, pid int) *OkCmdPacketType {
	return &OkCmdPacketType{Type: OkCmdPacketStr, Message: message, CmdId: cmdId, Pid: pid}
}

type RunPacketType struct {
	Type      string            `json:"type"`
	SessionId string            `json:"sessionid"`
	CmdId     string            `json:"cmdid"`
	ChDir     string            `json:"chdir"`
	Env       map[string]string `json:"env"`
	Command   string            `json:"command"`
}

func (ct *RunPacketType) GetType() string {
	return RunPacketStr
}

type BarePacketType struct {
	Type string `json:"type"`
}

type ErrorPacketType struct {
	Type  string `json:"type"`
	Error string `json:"error"`
}

func (et *ErrorPacketType) GetType() string {
	return ErrorPacketStr
}

func MakeErrorPacket(errorStr string) *ErrorPacketType {
	return &ErrorPacketType{Type: ErrorPacketStr, Error: errorStr}
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
	if bareCmd.Type == OkCmdPacketStr {
		var okPacket OkCmdPacketType
		err = json.Unmarshal(jsonBuf, &okPacket)
		if err != nil {
			return nil, err
		}
		return &okPacket, nil
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
