// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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
	Lock       *sync.Mutex
	MainCh     chan PacketType
	RpcMap     map[string]*RpcEntry
	RpcHandler bool
	Err        error
}

type RpcEntry struct {
	ReqId  string
	RespCh chan RpcResponsePacketType
}

type RpcResponseIter struct {
	ReqId  string
	Parser *PacketParser
}

func (iter *RpcResponseIter) Next(ctx context.Context) (RpcResponsePacketType, error) {
	// will unregister the rpc on ResponseDone
	return iter.Parser.GetNextResponse(ctx, iter.ReqId)
}

func (iter *RpcResponseIter) Close() {
	iter.Parser.UnRegisterRpc(iter.ReqId)
}

func CombinePacketParsers(p1 *PacketParser, p2 *PacketParser, rpcHandler bool) *PacketParser {
	rtnParser := &PacketParser{
		Lock:       &sync.Mutex{},
		MainCh:     make(chan PacketType),
		RpcMap:     make(map[string]*RpcEntry),
		RpcHandler: rpcHandler,
	}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for pk := range p1.MainCh {
			if rtnParser.RpcHandler {
				sent := rtnParser.trySendRpcResponse(pk)
				if sent {
					continue
				}
			}
			rtnParser.MainCh <- pk
		}
	}()
	go func() {
		defer wg.Done()
		for pk := range p2.MainCh {
			if rtnParser.RpcHandler {
				sent := rtnParser.trySendRpcResponse(pk)
				if sent {
					continue
				}
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

func (p *PacketParser) GetResponseIter(reqId string) *RpcResponseIter {
	return &RpcResponseIter{Parser: p, ReqId: reqId}
}

func (p *PacketParser) GetNextResponse(ctx context.Context, reqId string) (RpcResponsePacketType, error) {
	entry := p.getRpcEntry(reqId)
	if entry == nil {
		return nil, nil
	}
	select {
	case resp := <-entry.RespCh:
		if resp.GetResponseDone() {
			p.UnRegisterRpc(reqId)
		}
		return resp, nil
	case <-ctx.Done():
		return nil, ctx.Err()
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

// returns true if sent to an RPC channel.  false if not (which then allows the packet to be sent to MainCh)
// if GetResponseId() returns "", then this will return false
func (p *PacketParser) trySendRpcResponse(pk PacketType) bool {
	respPk, ok := pk.(RpcResponsePacketType)
	if !ok {
		return false
	}
	respId := respPk.GetResponseId()
	if respId == "" {
		return false
	}
	p.Lock.Lock()
	entry := p.RpcMap[respId]
	p.Lock.Unlock()
	if entry == nil {
		return false
	}
	entry.RespCh <- respPk
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

type PacketParserOpts struct {
	RpcHandler       bool
	IgnoreUntilValid bool
}

func MakePacketParser(input io.Reader, opts *PacketParserOpts) *PacketParser {
	if opts == nil {
		opts = &PacketParserOpts{}
	}
	parser := &PacketParser{
		Lock:       &sync.Mutex{},
		MainCh:     make(chan PacketType),
		RpcMap:     make(map[string]*RpcEntry),
		RpcHandler: opts.RpcHandler,
	}
	ignoreUntilValid := opts.IgnoreUntilValid
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
			hasPrefix := strings.HasPrefix(line, "##")
			bracePos := strings.Index(line, "{")
			if !hasPrefix || bracePos == -1 {
				if !ignoreUntilValid {
					parser.MainCh <- MakeRawPacket(line[:len(line)-1])
				}
				continue
			}
			ignoreUntilValid = false
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
			if parser.RpcHandler {
				sent := parser.trySendRpcResponse(pk)
				if sent {
					continue
				}
			}
			parser.MainCh <- pk
		}
	}()
	return parser
}
