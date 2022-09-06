// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package server

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"

	"github.com/alessio/shellescape"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/mshell/pkg/shexec"
)

// TODO create unblockable packet-sender (backed by an array) for clientproc
type MServer struct {
	Lock      *sync.Mutex
	MainInput *packet.PacketParser
	Sender    *packet.PacketSender
	ClientMap map[base.CommandKey]*shexec.ClientProc
	Debug     bool
}

func (m *MServer) Close() {
	m.Sender.Close()
	m.Sender.WaitForDone()
}

func (m *MServer) ProcessCommandPacket(pk packet.CommandPacketType) {
	ck := pk.GetCK()
	if ck == "" {
		m.Sender.SendMessage(fmt.Sprintf("received '%s' packet without ck", pk.GetType()))
		return
	}
	m.Lock.Lock()
	cproc := m.ClientMap[ck]
	m.Lock.Unlock()
	if cproc == nil {
		m.Sender.SendCmdError(ck, fmt.Errorf("no client proc for ck '%s', pk=%s", ck, packet.AsString(pk)))
		return
	}
	cproc.Input.SendPacket(pk)
	return
}

func runSingleCompGen(cwd string, compType string, prefix string) ([]string, bool, error) {
	if !packet.IsValidCompGenType(compType) {
		return nil, false, fmt.Errorf("invalid compgen type '%s'", compType)
	}
	compGenCmdStr := fmt.Sprintf("cd %s; compgen -A %s -- %s | sort | uniq | head -n %d", shellescape.Quote(cwd), shellescape.Quote(compType), shellescape.Quote(prefix), packet.MaxCompGenValues+1)
	ecmd := exec.Command("bash", "-c", compGenCmdStr)
	outputBytes, err := ecmd.Output()
	if err != nil {
		return nil, false, fmt.Errorf("compgen error: %w", err)
	}
	outputStr := string(outputBytes)
	parts := strings.Split(outputStr, "\n")
	if len(parts) > 0 && parts[len(parts)-1] == "" {
		parts = parts[0 : len(parts)-1]
	}
	hasMore := false
	if len(parts) > packet.MaxCompGenValues {
		hasMore = true
		parts = parts[0:packet.MaxCompGenValues]
	}
	return parts, hasMore, nil
}

func appendSlashes(comps []string) {
	for idx, comp := range comps {
		comps[idx] = comp + "/"
	}
}

func strArrToMap(strs []string) map[string]bool {
	rtn := make(map[string]bool)
	for _, s := range strs {
		rtn[s] = true
	}
	return rtn
}

func (m *MServer) runFileCompGen(compPk *packet.CompGenPacketType) {
	// get directories and files, unique them and put slashes on directories for completion
	reqId := compPk.GetReqId()
	compDirs, hasMoreDirs, err := runSingleCompGen(compPk.Cwd, "directory", compPk.Prefix)
	if err != nil {
		m.Sender.SendErrorResponse(reqId, err)
		return
	}
	compFiles, hasMoreFiles, err := runSingleCompGen(compPk.Cwd, "file", compPk.Prefix)
	if err != nil {
		m.Sender.SendErrorResponse(reqId, err)
		return
	}

	dirMap := strArrToMap(compDirs)
	// seed comps with dirs (but append slashes)
	comps := compDirs
	appendSlashes(comps)
	// add files that are not directories (look up in dirMap)
	for _, file := range compFiles {
		if dirMap[file] {
			continue
		}
		comps = append(comps, file)
	}
	sort.Strings(comps) // resort
	m.Sender.SendResponse(reqId, map[string]interface{}{"comps": comps, "hasmore": (hasMoreFiles || hasMoreDirs)})
	return
}

func (m *MServer) runCompGen(compPk *packet.CompGenPacketType) {
	reqId := compPk.GetReqId()
	if compPk.CompType == "file" {
		m.runFileCompGen(compPk)
		return
	}
	comps, hasMore, err := runSingleCompGen(compPk.Cwd, compPk.CompType, compPk.Prefix)
	if err != nil {
		m.Sender.SendErrorResponse(reqId, err)
		return
	}
	if compPk.CompType == "directory" {
		appendSlashes(comps)
	}
	m.Sender.SendResponse(reqId, map[string]interface{}{"comps": comps, "hasmore": hasMore})
	return
}

func (m *MServer) ProcessRpcPacket(pk packet.RpcPacketType) {
	reqId := pk.GetReqId()
	if cdPk, ok := pk.(*packet.CdPacketType); ok {
		err := os.Chdir(cdPk.Dir)
		if err != nil {
			m.Sender.SendErrorResponse(reqId, fmt.Errorf("cannot change directory: %w", err))
			return
		}
		m.Sender.SendResponse(reqId, true)
		return
	}
	if compPk, ok := pk.(*packet.CompGenPacketType); ok {
		go m.runCompGen(compPk)
		return
	}
	m.Sender.SendErrorResponse(reqId, fmt.Errorf("invalid rpc type '%s'", pk.GetType()))
	return
}

func (m *MServer) runCommand(runPacket *packet.RunPacketType) {
	if err := runPacket.CK.Validate("packet"); err != nil {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("server run packets require valid ck: %s", err))
		return
	}
	ecmd, err := shexec.SSHOpts{}.MakeMShellSingleCmd(true)
	if err != nil {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("server run packets require valid ck: %s", err))
		return
	}
	cproc, _, err := shexec.MakeClientProc(ecmd)
	if err != nil {
		m.Sender.SendErrorResponse(runPacket.ReqId, fmt.Errorf("starting mshell client: %s", err))
		return
	}
	m.Lock.Lock()
	m.ClientMap[runPacket.CK] = cproc
	m.Lock.Unlock()
	go func() {
		defer func() {
			m.Lock.Lock()
			delete(m.ClientMap, runPacket.CK)
			m.Lock.Unlock()
			cproc.Close()
		}()
		shexec.SendRunPacketAndRunData(context.Background(), cproc.Input, runPacket)
		cproc.ProxySingleOutput(runPacket.CK, m.Sender)
	}()
}

func RunServer() (int, error) {
	debug := false
	if len(os.Args) >= 3 && os.Args[2] == "--debug" {
		debug = true
	}
	server := &MServer{
		Lock:      &sync.Mutex{},
		ClientMap: make(map[base.CommandKey]*shexec.ClientProc),
		Debug:     debug,
	}
	if debug {
		packet.GlobalDebug = true
	}
	server.MainInput = packet.MakePacketParser(os.Stdin)
	server.Sender = packet.MakePacketSender(os.Stdout)
	defer server.Close()
	var err error
	initPacket, err := shexec.MakeServerInitPacket()
	if err != nil {
		return 1, err
	}
	server.Sender.SendPacket(initPacket)
	builder := packet.MakeRunPacketBuilder()
	for pk := range server.MainInput.MainCh {
		if server.Debug {
			fmt.Printf("PK> %s\n", packet.AsString(pk))
		}
		ok, runPacket := builder.ProcessPacket(pk)
		if ok {
			if runPacket != nil {
				server.runCommand(runPacket)
				continue
			}
			continue
		}
		if cmdPk, ok := pk.(packet.CommandPacketType); ok {
			server.ProcessCommandPacket(cmdPk)
			continue
		}
		if rpcPk, ok := pk.(packet.RpcPacketType); ok {
			server.ProcessRpcPacket(rpcPk)
			continue
		}
		server.Sender.SendMessage(fmt.Sprintf("invalid packet '%s' sent to mshell server", packet.AsString(pk)))
		continue
	}
	return 0, nil
}
