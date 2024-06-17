// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"reflect"
)

// these should both be 5 characters
const WaveOSC = "23198"
const WaveServerOSC = "23199"
const WaveOSCPrefixLen = 5 + 3 // \x1b] + WaveOSC + ; + \x07

const WaveOSCPrefix = "\x1b]" + WaveOSC + ";"
const WaveServerOSCPrefix = "\x1b]" + WaveServerOSC + ";"

const HexChars = "0123456789ABCDEF"
const BEL = 0x07
const ST = 0x9c
const ESC = 0x1b

// OSC escape types
// OSC 23198 ; (JSON | base64-JSON) ST
// JSON = must escape all ASCII control characters ([\x00-\x1F\x7F])
// we can tell the difference between JSON and base64-JSON by the first character: '{' or not

// for responses (terminal -> program), we'll use OSC 23199
// same json format

func copyOscPrefix(dst []byte, oscNum string) {
	dst[0] = ESC
	dst[1] = ']'
	copy(dst[2:], oscNum)
	dst[len(oscNum)+2] = ';'
}

func oscPrefixLen(oscNum string) int {
	return 3 + len(oscNum)
}

func makeOscPrefix(oscNum string) []byte {
	output := make([]byte, oscPrefixLen(oscNum))
	copyOscPrefix(output, oscNum)
	return output
}

func EncodeWaveReq(cmd BlockCommand) ([]byte, error) {
	req := &RpcRequest{Command: cmd}
	return EncodeWaveOSCMessage(req)
}

func EncodeWaveOSCMessage(msg RpcMessage) ([]byte, error) {
	return EncodeWaveOSCMessageEx(WaveOSC, msg)
}

func EncodeWaveOSCMessageEx(oscNum string, msg RpcMessage) ([]byte, error) {
	if msg == nil {
		return nil, fmt.Errorf("nil message")
	}
	barr, err := json.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("error marshalling message to json: %w", err)
	}
	hasControlChars := false
	for _, b := range barr {
		if b < 0x20 || b == 0x7F {
			hasControlChars = true
			break
		}
	}
	if !hasControlChars {
		// If no control characters, directly construct the output
		// \x1b] (2) + WaveOSC + ; (1) + message + \x07 (1)
		output := make([]byte, oscPrefixLen(oscNum)+len(barr)+1)
		copyOscPrefix(output, oscNum)
		copy(output[oscPrefixLen(oscNum):], barr)
		output[len(output)-1] = BEL
		return output, nil
	}

	var buf bytes.Buffer
	buf.Write(makeOscPrefix(oscNum))
	escSeq := [6]byte{'\\', 'u', '0', '0', '0', '0'}
	for _, b := range barr {
		if b < 0x20 || b == 0x7f {
			escSeq[4] = HexChars[b>>4]
			escSeq[5] = HexChars[b&0x0f]
			buf.Write(escSeq[:])
		} else {
			buf.WriteByte(b)
		}
	}
	buf.WriteByte(BEL)
	return buf.Bytes(), nil
}

func decodeWaveOSCMessage(data []byte) (BlockCommand, error) {
	var baseCmd baseCommand
	err := json.Unmarshal(data, &baseCmd)
	if err != nil {
		return nil, fmt.Errorf("error unmarshalling json: %w", err)
	}
	rtnCmd := reflect.New(CommandToTypeMap[baseCmd.Command]).Interface()
	err = json.Unmarshal(data, rtnCmd)
	if err != nil {
		return nil, fmt.Errorf("error unmarshalling json: %w", err)
	}
	return rtnCmd.(BlockCommand), nil
}

// data does not contain the escape sequence, just the innards
// this function implements the switch between JSON and base64-JSON
func DecodeWaveOSCMessage(data []byte) (BlockCommand, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty data")
	}
	if data[0] != '{' {
		// decode base64
		rtnLen := base64.StdEncoding.DecodedLen(len(data))
		rtn := make([]byte, rtnLen)
		nw, err := base64.StdEncoding.Decode(rtn, data)
		if err != nil {
			return nil, fmt.Errorf("error decoding base64: %w", err)
		}
		return decodeWaveOSCMessage(rtn[:nw])
	}
	return decodeWaveOSCMessage(data)
}
