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
	"regexp"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
)

const MaxDataBytes = 4096
const FileTypePty = "ptyout"
const FileTypeRun = "runout"

type TailPos struct {
	ReqId      string
	Running    bool // an active tailer sending data
	TailPtyPos int64
	TailRunPos int64
	Follow     bool
}

type CmdWatchEntry struct {
	CmdKey     base.CommandKey
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

func (w *CmdWatchEntry) updateTailPos(reqId string, newPos TailPos) {
	for idx, pos := range w.Tails {
		if pos.ReqId == reqId {
			w.Tails[idx] = newPos
			return
		}
	}
	w.Tails = append(w.Tails, newPos)
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

type Tailer struct {
	Lock      *sync.Mutex
	WatchList map[base.CommandKey]CmdWatchEntry
	MHomeDir  string
	Watcher   *fsnotify.Watcher
	Sender    *packet.PacketSender
}

func (t *Tailer) updateTailPos_nolock(cmdKey base.CommandKey, reqId string, pos TailPos) {
	entry, found := t.WatchList[cmdKey]
	if !found {
		return
	}
	entry.updateTailPos(reqId, pos)
	t.WatchList[cmdKey] = entry
}

func (t *Tailer) removeTailPos_nolock(cmdKey base.CommandKey, reqId string) {
	entry, found := t.WatchList[cmdKey]
	if !found {
		return
	}
	entry.removeTailPos(reqId)
	if len(entry.Tails) > 0 {
		t.WatchList[cmdKey] = entry
		return
	}

	// delete from watchlist, remove watches
	fileNames := base.MakeCommandFileNamesWithHome(t.MHomeDir, cmdKey)
	delete(t.WatchList, cmdKey)
	t.Watcher.Remove(fileNames.PtyOutFile)
	t.Watcher.Remove(fileNames.RunnerOutFile)
}

func (t *Tailer) updateEntrySizes_nolock(cmdKey base.CommandKey, ptyLen int64, runLen int64) {
	entry, found := t.WatchList[cmdKey]
	if !found {
		return
	}
	entry.FilePtyLen = ptyLen
	entry.FileRunLen = runLen
	t.WatchList[cmdKey] = entry
}

func (t *Tailer) getEntryAndPos_nolock(cmdKey base.CommandKey, reqId string) (CmdWatchEntry, TailPos, bool) {
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

func MakeTailer(sender *packet.PacketSender) (*Tailer, error) {
	mhomeDir := base.GetMShellHomeDir()
	rtn := &Tailer{
		Lock:      &sync.Mutex{},
		WatchList: make(map[base.CommandKey]CmdWatchEntry),
		MHomeDir:  mhomeDir,
		Sender:    sender,
	}
	var err error
	rtn.Watcher, err = fsnotify.NewWatcher()
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
	dataPacket.CK = entry.CmdKey
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
func (t *Tailer) runSingleDataTransfer(key base.CommandKey, reqId string) (*packet.CmdDataPacketType, bool) {
	t.Lock.Lock()
	entry, pos, foundPos := t.getEntryAndPos_nolock(key, reqId)
	t.Lock.Unlock()
	if !foundPos {
		return nil, false
	}
	fileNames := base.MakeCommandFileNamesWithHome(t.MHomeDir, key)
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

func (t *Tailer) checkRemoveNoFollow(cmdKey base.CommandKey, reqId string) {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	_, pos, foundPos := t.getEntryAndPos_nolock(cmdKey, reqId)
	if !foundPos {
		return
	}
	if !pos.Follow {
		t.removeTailPos_nolock(cmdKey, reqId)
	}
}

func (t *Tailer) RunDataTransfer(key base.CommandKey, reqId string) {
	for {
		dataPacket, keepRunning := t.runSingleDataTransfer(key, reqId)
		if dataPacket != nil {
			t.Sender.SendPacket(dataPacket)
		}
		if !keepRunning {
			t.checkRemoveNoFollow(key, reqId)
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (t *Tailer) tryStartRun_nolock(entry CmdWatchEntry, pos TailPos) {
	if pos.Running {
		return
	}
	if pos.IsCurrent(entry) {

		return
	}
	pos.Running = true
	t.updateTailPos_nolock(entry.CmdKey, pos.ReqId, pos)
	go t.RunDataTransfer(entry.CmdKey, pos.ReqId)
}

var updateFileRe = regexp.MustCompile("/([a-z0-9-]+)/([a-z0-9-]+)\\.(ptyout|runout)$")

func (t *Tailer) updateFile(relFileName string) {
	m := updateFileRe.FindStringSubmatch(relFileName)
	if m == nil {
		return
	}
	finfo, err := os.Stat(relFileName)
	if err != nil {
		t.Sender.SendPacket(packet.FmtMessagePacket("error trying to stat file '%s': %v", relFileName, err))
		return
	}
	cmdKey := base.MakeCommandKey(m[1], m[2])
	t.Lock.Lock()
	defer t.Lock.Unlock()
	entry, foundEntry := t.WatchList[cmdKey]
	if !foundEntry {
		return
	}
	fileType := m[3]
	if fileType == FileTypePty {
		entry.FilePtyLen = finfo.Size()
	} else if fileType == FileTypeRun {
		entry.FileRunLen = finfo.Size()
	}
	t.WatchList[cmdKey] = entry
	for _, pos := range entry.Tails {
		t.tryStartRun_nolock(entry, pos)
	}
}

func (t *Tailer) Run() {
	for {
		select {
		case event, ok := <-t.Watcher.Events:
			if !ok {
				return
			}
			if event.Op&fsnotify.Write == fsnotify.Write {
				t.updateFile(event.Name)
			}

		case err, ok := <-t.Watcher.Errors:
			if !ok {
				return
			}
			// what to do with this error?  just send a message
			t.Sender.SendPacket(packet.FmtMessagePacket("error in tailer: %v", err))
		}
	}
	return
}

func (t *Tailer) Close() error {
	return t.Watcher.Close()
}

func max(v1 int64, v2 int64) int64 {
	if v1 > v2 {
		return v1
	}
	return v2
}

func (entry *CmdWatchEntry) fillFilePos(scHomeDir string) {
	fileNames := base.MakeCommandFileNamesWithHome(scHomeDir, entry.CmdKey)
	ptyInfo, _ := os.Stat(fileNames.PtyOutFile)
	if ptyInfo != nil {
		entry.FilePtyLen = ptyInfo.Size()
	}
	runoutInfo, _ := os.Stat(fileNames.RunnerOutFile)
	if runoutInfo != nil {
		entry.FileRunLen = runoutInfo.Size()
	}
}

func (t *Tailer) RemoveWatch(pk *packet.UntailCmdPacketType) {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	t.removeTailPos_nolock(pk.CK, pk.ReqId)
}

func (t *Tailer) AddWatch(getPacket *packet.GetCmdPacketType) error {
	if err := getPacket.CK.Validate("getcmd"); err != nil {
		return err
	}
	if getPacket.ReqId == "" {
		return fmt.Errorf("getcmd, no reqid specified")
	}
	fileNames := base.MakeCommandFileNamesWithHome(t.MHomeDir, getPacket.CK)
	t.Lock.Lock()
	defer t.Lock.Unlock()
	key := getPacket.CK
	entry, foundEntry := t.WatchList[key]
	if !foundEntry {
		// add watches, initialize entry
		err := t.Watcher.Add(fileNames.PtyOutFile)
		if err != nil {
			return err
		}
		err = t.Watcher.Add(fileNames.RunnerOutFile)
		if err != nil {
			t.Watcher.Remove(fileNames.PtyOutFile) // best effort clean up
			return err
		}
		entry = CmdWatchEntry{CmdKey: key}
		entry.fillFilePos(t.MHomeDir)
	}
	pos, foundPos := entry.getTailPos(getPacket.ReqId)
	if !foundPos {
		// initialize a new tailpos
		pos = TailPos{ReqId: getPacket.ReqId}
	}
	// update tailpos with new values from getpacket
	pos.TailPtyPos = getPacket.PtyPos
	pos.TailRunPos = getPacket.RunPos
	pos.Follow = getPacket.Tail
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
