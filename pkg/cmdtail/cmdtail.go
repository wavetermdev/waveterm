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
	ReqId      string
	Running    bool // an active tailer sending data
	TailPtyPos int64
	TailRunPos int64
	Follow     bool
}

type CmdWatchEntry struct {
	CmdKey     CmdKey
	FilePtyLen int64
	FileRunLen int64
	Tails      []TailPos
}

func (w CmdWatchEntry) getTailPos(reqId string) (TailPos, bool) {
	for _, pos := range w.Tails {
		if pos.ReqId == reqId {
			return pos, true
		}
	}
	return TailPos{}, false
}

func (w *CmdWatchEntry) updateTailPos(reqId string, pos TailPos) {
	for idx, pos := range w.Tails {
		if pos.ReqId == reqId {
			w.Tails[idx] = pos
			return
		}
	}
	w.Tails = append(w.Tails, pos)
}

func (w *CmdWatchEntry) removeTailPos(reqId string) {
	var newTails []TailPos
	for _, pos := range w.Tails {
		if pos.ReqId == reqId {
			continue
		}
		newTails = append(newTails, pos)
	}
	w.Tails = newTails
}

func (pos TailPos) IsCurrent(entry CmdWatchEntry) bool {
	return pos.TailPtyPos >= entry.FilePtyLen && pos.TailRunPos >= entry.FileRunLen
}

type CmdKey struct {
	SessionId string
	CmdId     string
}

type Tailer struct {
	Lock      *sync.Mutex
	WatchList map[CmdKey]CmdWatchEntry
	ScHomeDir string
	Watcher   *SessionWatcher
	SendCh    chan packet.PacketType
}

func (t *Tailer) updateTailPos_nolock(cmdKey CmdKey, reqId string, pos TailPos) {
	entry, found := t.WatchList[cmdKey]
	if !found {
		return
	}
	entry.updateTailPos(reqId, pos)
	t.WatchList[cmdKey] = entry
}

func (t *Tailer) updateEntrySizes_nolock(cmdKey CmdKey, ptyLen int64, runLen int64) {
	entry, found := t.WatchList[cmdKey]
	if !found {
		return
	}
	entry.FilePtyLen = ptyLen
	entry.FileRunLen = runLen
	t.WatchList[cmdKey] = entry
}

func (t *Tailer) getEntryAndPos_nolock(cmdKey CmdKey, reqId string) (CmdWatchEntry, TailPos, bool) {
	entry, found := t.WatchList[cmdKey]
	if !found {
		return CmdWatchEntry{}, TailPos{}, false
	}
	pos, found := entry.getTailPos(reqId)
	if !found {
		return CmdWatchEntry{}, TailPos{}, false
	}
	return entry, pos, true
}

func MakeTailer(sendCh chan packet.PacketType) (*Tailer, error) {
	scHomeDir, err := base.GetScHomeDir()
	if err != nil {
		return nil, err
	}
	rtn := &Tailer{
		Lock:      &sync.Mutex{},
		WatchList: make(map[CmdKey]CmdWatchEntry),
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

func (t *Tailer) makeCmdDataPacket(fileNames *base.CommandFileNames, entry CmdWatchEntry, pos TailPos) *packet.CmdDataPacketType {
	dataPacket := packet.MakeCmdDataPacket()
	dataPacket.ReqId = pos.ReqId
	dataPacket.SessionId = entry.CmdKey.SessionId
	dataPacket.CmdId = entry.CmdKey.CmdId
	dataPacket.PtyPos = pos.TailPtyPos
	dataPacket.RunPos = pos.TailRunPos
	if entry.FilePtyLen > pos.TailPtyPos {
		ptyData, err := t.readDataFromFile(fileNames.PtyOutFile, pos.TailPtyPos, MaxDataBytes)
		if err != nil {
			dataPacket.Error = err.Error()
			return dataPacket
		}
		dataPacket.PtyData = string(ptyData)
		dataPacket.PtyDataLen = len(ptyData)
	}
	if entry.FileRunLen > pos.TailRunPos {
		runData, err := t.readDataFromFile(fileNames.RunnerOutFile, pos.TailRunPos, MaxDataBytes)
		if err != nil {
			dataPacket.Error = err.Error()
			return dataPacket
		}
		dataPacket.RunData = string(runData)
		dataPacket.RunDataLen = len(runData)
	}
	return dataPacket
}

// returns (data-packet, keepRunning)
func (t *Tailer) runSingleDataTransfer(key CmdKey, reqId string) (*packet.CmdDataPacketType, bool) {
	t.Lock.Lock()
	entry, pos, foundPos := t.getEntryAndPos_nolock(key, reqId)
	t.Lock.Unlock()
	if !foundPos {
		return nil, false
	}
	fileNames := base.MakeCommandFileNamesWithHome(t.ScHomeDir, key.SessionId, key.CmdId)
	dataPacket := t.makeCmdDataPacket(fileNames, entry, pos)

	t.Lock.Lock()
	defer t.Lock.Unlock()
	entry, pos, foundPos = t.getEntryAndPos_nolock(key, reqId)
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
		t.updateTailPos_nolock(key, reqId, pos)
		return dataPacket, false
	}
	pos.TailPtyPos += int64(len(dataPacket.PtyData))
	pos.TailRunPos += int64(len(dataPacket.RunData))
	if pos.TailPtyPos >= entry.FilePtyLen && pos.TailRunPos >= entry.FileRunLen {
		// we caught up, tail position equals file length
		pos.Running = false
	}
	t.updateTailPos_nolock(key, reqId, pos)
	return dataPacket, pos.Running
}

func (t *Tailer) checkRemoveNoFollow(cmdKey CmdKey, reqId string) {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	entry, pos, foundPos := t.getEntryAndPos_nolock(cmdKey, reqId)
	if !foundPos {
		return
	}
	if !pos.Follow {
		entry.removeTailPos(reqId)
		if len(entry.Tails) == 0 {
			delete(t.WatchList, cmdKey)
		} else {
			t.WatchList[cmdKey] = entry
		}
	}
}

func (t *Tailer) RunDataTransfer(key CmdKey, reqId string) {
	for {
		dataPacket, keepRunning := t.runSingleDataTransfer(key, reqId)
		if dataPacket != nil {
			t.SendCh <- dataPacket
		}
		if !keepRunning {
			t.checkRemoveNoFollow(key, reqId)
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// should already hold t.Lock
func (t *Tailer) tryStartRun_nolock(entry CmdWatchEntry, pos TailPos) {
	if pos.Running || pos.IsCurrent(entry) {
		return
	}
	pos.Running = true
	t.updateTailPos_nolock(entry.CmdKey, pos.ReqId, pos)
	go t.RunDataTransfer(entry.CmdKey, pos.ReqId)
}

func (t *Tailer) updateFile(event FileUpdateEvent) {
	if event.Err != nil {
		t.SendCh <- packet.FmtMessagePacket("error in FileUpdateEvent %s/%s: %v", event.SessionId, event.CmdId, event.Err)
		return
	}
	cmdKey := CmdKey{SessionId: event.SessionId, CmdId: event.CmdId}
	t.Lock.Lock()
	defer t.Lock.Unlock()
	entry, foundEntry := t.WatchList[cmdKey]
	if !foundEntry {
		return
	}
	if event.FileType == FileTypePty {
		entry.FilePtyLen = event.Size
	} else if event.FileType == FileTypeRun {
		entry.FileRunLen = event.Size
	}
	t.WatchList[cmdKey] = entry
	for _, pos := range entry.Tails {
		t.tryStartRun_nolock(entry, pos)
	}
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

func (entry *CmdWatchEntry) fillFilePos(scHomeDir string) {
	fileNames := base.MakeCommandFileNamesWithHome(scHomeDir, entry.CmdKey.SessionId, entry.CmdKey.CmdId)
	ptyInfo, _ := os.Stat(fileNames.PtyOutFile)
	if ptyInfo != nil {
		entry.FilePtyLen = ptyInfo.Size()
	}
	runoutInfo, _ := os.Stat(fileNames.RunnerOutFile)
	if runoutInfo != nil {
		entry.FileRunLen = runoutInfo.Size()
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
	if getPacket.ReqId == "" {
		return fmt.Errorf("getcmd, no reqid specified")
	}
	t.Lock.Lock()
	defer t.Lock.Unlock()
	key := CmdKey{getPacket.SessionId, getPacket.CmdId}
	err = t.Watcher.WatchSession(getPacket.SessionId)
	if err != nil {
		return fmt.Errorf("error trying to watch sesion '%s': %v", getPacket.SessionId, err)
	}
	entry, foundEntry := t.WatchList[key]
	if !foundEntry {
		entry = CmdWatchEntry{CmdKey: key}
		entry.fillFilePos(t.ScHomeDir)
	}
	pos := TailPos{ReqId: getPacket.ReqId, TailPtyPos: getPacket.PtyPos, TailRunPos: getPacket.RunPos, Follow: getPacket.Tail}
	// convert negative pos to positive
	if pos.TailPtyPos < 0 {
		pos.TailPtyPos = max(0, entry.FilePtyLen+pos.TailPtyPos) // + because negative
	}
	if pos.TailRunPos < 0 {
		pos.TailRunPos = max(0, entry.FileRunLen+pos.TailRunPos) // + because negative
	}
	entry.updateTailPos(pos.ReqId, pos)
	t.WatchList[key] = entry
	t.tryStartRun_nolock(entry, pos)
	return nil
}
