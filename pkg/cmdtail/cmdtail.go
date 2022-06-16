// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package cmdtail

import (
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/sh2-runner/pkg/base"
	"github.com/scripthaus-dev/sh2-runner/pkg/packet"
)

const MaxDataBytes = 4096

type TailPos struct {
	CmdKey     CmdKey
	Running    bool // an active tailer sending data
	FilePtyLen int64
	FileRunLen int64
	TailPtyPos int64
	TailRunPos int64
	Follow     bool
}

func (pos TailPos) IsCurrent() bool {
	return pos.TailPtyPos >= pos.FilePtyLen && pos.TailRunPos >= pos.FileRunLen
}

type CmdKey struct {
	SessionId string
	CmdId     string
}

type Tailer struct {
	Lock      *sync.Mutex
	WatchList map[CmdKey]TailPos
	ScHomeDir string
	Watcher   *SessionWatcher
	SendCh    chan packet.PacketType
}

func MakeTailer(sendCh chan packet.PacketType) (*Tailer, error) {
	scHomeDir, err := base.GetScHomeDir()
	if err != nil {
		return nil, err
	}
	rtn := &Tailer{
		Lock:      &sync.Mutex{},
		WatchList: make(map[CmdKey]TailPos),
		ScHomeDir: scHomeDir,
		SendCh:    sendCh,
	}
	rtn.Watcher, err = MakeSessionWatcher()
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func (t *Tailer) readDataFromFile(fileName string, pos int64, maxBytes int) ([]byte, error) {
	fd, err := os.Open(fileName)
	defer fd.Close()
	if err != nil {
		return nil, err
	}
	buf := make([]byte, maxBytes)
	nr, err := fd.ReadAt(buf, pos)
	if err != nil && err != io.EOF { // ignore EOF error
		return nil, err
	}
	return buf[0:nr], nil
}

func (t *Tailer) makeCmdDataPacket(fileNames *base.CommandFileNames, pos TailPos) *packet.CmdDataPacketType {
	dataPacket := packet.MakeCmdDataPacket()
	dataPacket.SessionId = pos.CmdKey.SessionId
	dataPacket.CmdId = pos.CmdKey.CmdId
	dataPacket.PtyPos = pos.TailPtyPos
	dataPacket.RunPos = pos.TailRunPos
	if pos.FilePtyLen > pos.TailPtyPos {
		ptyData, err := t.readDataFromFile(fileNames.PtyOutFile, pos.TailPtyPos, MaxDataBytes)
		if err != nil {
			dataPacket.Error = err.Error()
			return dataPacket
		}
		dataPacket.PtyData = string(ptyData)
	}
	if pos.FileRunLen > pos.TailRunPos {
		runData, err := t.readDataFromFile(fileNames.RunnerOutFile, pos.TailRunPos, MaxDataBytes)
		if err != nil {
			dataPacket.Error = err.Error()
			return dataPacket
		}
		dataPacket.RunData = string(runData)
	}
	return dataPacket
}

// returns (data-packet, keepRunning)
func (t *Tailer) runSingleDataTransfer(key CmdKey) (*packet.CmdDataPacketType, bool) {
	t.Lock.Lock()
	pos, foundPos := t.WatchList[key]
	t.Lock.Unlock()
	if !foundPos {
		return nil, false
	}
	fileNames := base.MakeCommandFileNamesWithHome(t.ScHomeDir, key.SessionId, key.CmdId)
	dataPacket := t.makeCmdDataPacket(fileNames, pos)

	t.Lock.Lock()
	defer t.Lock.Unlock()
	pos, foundPos = t.WatchList[key]
	if !foundPos {
		return nil, false
	}
	// pos was updated between first and second get, throw out data-packet and re-run
	if pos.TailPtyPos != dataPacket.PtyPos || pos.TailRunPos != dataPacket.RunPos {
		return nil, true
	}
	if dataPacket.Error != "" {
		// error, so return error packet, and stop running
		pos.Running = false
		t.WatchList[key] = pos
		return dataPacket, false
	}
	pos.TailPtyPos += int64(len(dataPacket.PtyData))
	pos.TailRunPos += int64(len(dataPacket.RunData))
	if pos.TailPtyPos > pos.FilePtyLen {
		pos.FilePtyLen = pos.TailPtyPos
	}
	if pos.TailRunPos > pos.FileRunLen {
		pos.FileRunLen = pos.TailRunPos
	}
	if pos.TailPtyPos >= pos.FilePtyLen && pos.TailRunPos >= pos.FileRunLen {
		// we caught up, tail position equals file length
		pos.Running = false
	}
	t.WatchList[key] = pos
	return dataPacket, pos.Running
}

func (t *Tailer) checkRemoveNoFollow(cmdKey CmdKey) {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	pos, foundPos := t.WatchList[cmdKey]
	if !foundPos {
		return
	}
	if !pos.Follow {
		delete(t.WatchList, cmdKey)
	}
}

func (t *Tailer) RunDataTransfer(key CmdKey) {
	for {
		dataPacket, keepRunning := t.runSingleDataTransfer(key)
		if dataPacket != nil {
			t.SendCh <- dataPacket
		}
		if !keepRunning {
			t.checkRemoveNoFollow(key)
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// should already hold t.Lock
func (t *Tailer) tryStartRun_nolock(pos TailPos) {
	if pos.Running || pos.IsCurrent() {
		return
	}
	pos.Running = true
	t.WatchList[pos.CmdKey] = pos
	go t.RunDataTransfer(pos.CmdKey)
}

func (t *Tailer) updateFile(event FileUpdateEvent) {
	if event.Err != nil {
		t.SendCh <- packet.FmtMessagePacket("error in FileUpdateEvent %s/%s: %v", event.SessionId, event.CmdId, event.Err)
		return
	}
	cmdKey := CmdKey{SessionId: event.SessionId, CmdId: event.CmdId}
	t.Lock.Lock()
	defer t.Lock.Unlock()
	pos, foundPos := t.WatchList[cmdKey]
	if !foundPos {
		return
	}
	if event.FileType == FileTypePty {
		pos.FilePtyLen = event.Size
	} else if event.FileType == FileTypeRun {
		pos.FileRunLen = event.Size
	}
	t.WatchList[cmdKey] = pos
	t.tryStartRun_nolock(pos)
}

func (t *Tailer) Run() error {
	go func() {
		for event := range t.Watcher.EventCh {
			t.updateFile(event)
		}
	}()
	err := t.Watcher.Run(nil)
	return err
}

func max(v1 int64, v2 int64) int64 {
	if v1 > v2 {
		return v1
	}
	return v2
}

// also converts negative positions to positive positions
func (tp *TailPos) fillFilePos(scHomeDir string) {
	fileNames := base.MakeCommandFileNamesWithHome(scHomeDir, tp.CmdKey.SessionId, tp.CmdKey.CmdId)
	ptyInfo, _ := os.Stat(fileNames.PtyOutFile)
	if ptyInfo != nil {
		tp.FilePtyLen = ptyInfo.Size()
	}
	if tp.TailPtyPos < 0 {
		tp.TailPtyPos = max(0, tp.FilePtyLen-tp.TailPtyPos)
	}
	runoutInfo, _ := os.Stat(fileNames.RunnerOutFile)
	if runoutInfo != nil {
		tp.FileRunLen = runoutInfo.Size()
	}
	if tp.TailRunPos < 0 {
		tp.TailRunPos = max(0, tp.FileRunLen-tp.TailRunPos)
	}
}

func (t *Tailer) AddWatch(getPacket *packet.GetCmdPacketType) error {
	if !getPacket.Tail {
		return fmt.Errorf("cannot add a watch for non-tail packet")
	}
	_, err := uuid.Parse(getPacket.SessionId)
	if err != nil {
		return fmt.Errorf("getcmd, bad sessionid '%s': %w", getPacket.SessionId, err)
	}
	_, err = uuid.Parse(getPacket.CmdId)
	if err != nil {
		return fmt.Errorf("getcmd, bad cmdid '%s': %w", getPacket.CmdId, err)
	}
	t.Lock.Lock()
	defer t.Lock.Unlock()
	key := CmdKey{getPacket.SessionId, getPacket.CmdId}
	err = t.Watcher.WatchSession(getPacket.SessionId)
	if err != nil {
		return fmt.Errorf("error trying to watch sesion '%s': %v", getPacket.SessionId, err)
	}
	pos := TailPos{CmdKey: key, TailPtyPos: getPacket.PtyPos, TailRunPos: getPacket.RunPos, Follow: getPacket.Tail}
	pos.fillFilePos(t.ScHomeDir)
	t.WatchList[key] = pos
	t.tryStartRun_nolock(pos)
	return nil
}
