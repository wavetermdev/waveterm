// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package packet

import (
	"bufio"
	"context"
	"io"
	"strconv"
	"strings"
	"sync"
)

type PacketParser struct {
	Lock   *sync.Mutex
	MainCh chan PacketType
	RpcMap map[string]*RpcEntry
	Err    error
}

type RpcEntry struct {
	ReqId  string
	RespCh chan RpcResponsePacketType
}

func CombinePacketParsers(p1 *PacketParser, p2 *PacketParser) *PacketParser {
	rtnParser := &PacketParser{
		Lock:   &sync.Mutex{},
		MainCh: make(chan PacketType),
		RpcMap: make(map[string]*RpcEntry),
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for pk := range p1.MainCh {
			sent := rtnParser.trySendRpcResponse(pk)
			if sent {
				continue
			}
			rtnParser.MainCh <- pk
		}
	}()
	go func() {
		defer wg.Done()
		for pk := range p2.MainCh {
			sent := rtnParser.trySendRpcResponse(pk)
			if sent {
				continue
			}
			rtnParser.MainCh <- pk
		}
	}()
	go func() {
		wg.Wait()
		close(rtnParser.MainCh)
	}()
	return rtnParser
}

// should have already registered rpc
func (p *PacketParser) WaitForResponse(ctx context.Context, reqId string) RpcResponsePacketType {
	entry := p.getRpcEntry(reqId)
	if entry == nil {
		return nil
	}
	defer p.UnRegisterRpc(reqId)
	select {
	case resp := <-entry.RespCh:
		return resp
	case <-ctx.Done():
		return nil
	}
}

func (p *PacketParser) UnRegisterRpc(reqId string) {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	entry := p.RpcMap[reqId]
	if entry != nil {
		close(entry.RespCh)
		delete(p.RpcMap, reqId)
	}
}

func (p *PacketParser) RegisterRpc(reqId string) chan RpcResponsePacketType {
	return p.RegisterRpcSz(reqId, 2)
}

func (p *PacketParser) RegisterRpcSz(reqId string, queueSize int) chan RpcResponsePacketType {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	ch := make(chan RpcResponsePacketType, queueSize)
	entry := &RpcEntry{ReqId: reqId, RespCh: ch}
	p.RpcMap[reqId] = entry
	return ch
}

func (p *PacketParser) getRpcEntry(reqId string) *RpcEntry {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	entry := p.RpcMap[reqId]
	return entry
}

func (p *PacketParser) trySendRpcResponse(pk PacketType) bool {
	respPk, ok := pk.(RpcResponsePacketType)
	if !ok {
		return false
	}
	p.Lock.Lock()
	defer p.Lock.Unlock()
	entry := p.RpcMap[respPk.GetResponseId()]
	if entry == nil {
		return false
	}
	// nonblocking send
	select {
	case entry.RespCh <- respPk:
	default:
	}
	if respPk.GetResponseDone() {
		delete(p.RpcMap, respPk.GetResponseId())
		close(entry.RespCh)
	}
	return true
}

func (p *PacketParser) GetErr() error {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	return p.Err
}

func (p *PacketParser) SetErr(err error) {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	if p.Err == nil {
		p.Err = err
	}
}

func MakePacketParser(input io.Reader) *PacketParser {
	parser := &PacketParser{
		Lock:   &sync.Mutex{},
		MainCh: make(chan PacketType),
		RpcMap: make(map[string]*RpcEntry),
	}
	bufReader := bufio.NewReader(input)
	go func() {
		defer func() {
			close(parser.MainCh)
		}()
		for {
			line, err := bufReader.ReadString('\n')
			if err == io.EOF {
				return
			}
			if err != nil {
				parser.SetErr(err)
				return
			}
			if line == "\n" {
				continue
			}
			// ##[len][json]\n
			// ##14{"hello":true}\n
			// ##N{...}
			bracePos := strings.Index(line, "{")
			if !strings.HasPrefix(line, "##") || bracePos == -1 {
				parser.MainCh <- MakeRawPacket(line[:len(line)-1])
				continue
			}
			packetLen := -1
			if line[2:bracePos] != "N" {
				packetLen, err = strconv.Atoi(line[2:bracePos])
				if err != nil || packetLen != len(line)-bracePos-1 {
					parser.MainCh <- MakeRawPacket(line[:len(line)-1])
					continue
				}
			}
			pk, err := ParseJsonPacket([]byte(line[bracePos:]))
			if err != nil {
				parser.MainCh <- MakeRawPacket(line[:len(line)-1])
				continue
			}
			if pk.GetType() == DonePacketStr {
				return
			}
			if pk.GetType() == PingPacketStr {
				continue
			}
			sent := parser.trySendRpcResponse(pk)
			if sent {
				continue
			}
			parser.MainCh <- pk
		}
	}()
	return parser
}
