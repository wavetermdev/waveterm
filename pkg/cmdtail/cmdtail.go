// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package cmdtail

import (
	"encoding/base64"
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

type Tailer struct {
	Lock      *sync.Mutex
	WatchList map[base.CommandKey]CmdWatchEntry
	Watcher   *fsnotify.Watcher
	Sender    *packet.PacketSender
	Gen       FileNameGenerator
	Sessions  map[string]bool
}

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
	Done       bool
}

type FileNameGenerator interface {
	PtyOutFile(ck base.CommandKey) string
	RunOutFile(ck base.CommandKey) string
	SessionDir(sessionId string) string
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

func (t *Tailer) updateTailPos_nolock(cmdKey base.CommandKey, reqId string, pos TailPos) {
	entry, found := t.WatchList[cmdKey]
	if !found {
		return
	}
	entry.updateTailPos(reqId, pos)
	t.WatchList[cmdKey] = entry
}

func (t *Tailer) removeTailPos(cmdKey base.CommandKey, reqId string) {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	t.removeTailPos_nolock(cmdKey, reqId)
}

func (t *Tailer) removeTailPos_nolock(cmdKey base.CommandKey, reqId string) {
	entry, found := t.WatchList[cmdKey]
	if !found {
		return
	}
	entry.removeTailPos(reqId)
	t.WatchList[cmdKey] = entry
	if len(entry.Tails) == 0 {
		t.removeWatch_nolock(cmdKey)
	}
}

func (t *Tailer) removeWatch_nolock(cmdKey base.CommandKey) {
	// delete from watchlist, remove watches
	delete(t.WatchList, cmdKey)
	t.Watcher.Remove(t.Gen.PtyOutFile(cmdKey))
	t.Watcher.Remove(t.Gen.RunOutFile(cmdKey))
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

func (t *Tailer) addSessionWatcher(sessionId string) error {
	t.Lock.Lock()
	defer t.Lock.Unlock()

	if t.Sessions[sessionId] {
		return
	}
	sdir := t.Gen.SessionDir(sessionId)
	err := t.Watcher.Add(sdir)
	if err != nil {
		return err
	}
	t.Sessions[sessionId] = true
	return nil
}

func (t *Tailer) removeSessionWatcher(sessionId string) {
	t.Lock.Lock()
	defer t.Lock.Unlock()

	if !t.Sessions[sessionId] {
		return
	}
	sdir := t.Gen.SessionDir(sessionId)
	t.Watcher.Remove(sdir)
}

func MakeTailer(sender *packet.PacketSender, gen FileNameGenerator) (*Tailer, error) {
	rtn := &Tailer{
		Lock:      &sync.Mutex{},
		WatchList: make(map[base.CommandKey]CmdWatchEntry),
		Sessions:  make(map[string]bool),
		Sender:    sender,
		Gen:       gen,
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

func (t *Tailer) makeCmdDataPacket(entry CmdWatchEntry, pos TailPos) (*packet.CmdDataPacketType, error) {
	dataPacket := packet.MakeCmdDataPacket(pos.ReqId)
	dataPacket.CK = entry.CmdKey
	dataPacket.PtyPos = pos.TailPtyPos
	dataPacket.RunPos = pos.TailRunPos
	if entry.FilePtyLen > pos.TailPtyPos {
		ptyData, err := t.readDataFromFile(t.Gen.PtyOutFile(entry.CmdKey), pos.TailPtyPos, MaxDataBytes)
		if err != nil {
			return nil, err
		}
		dataPacket.PtyData64 = base64.StdEncoding.EncodeToString(ptyData)
		dataPacket.PtyDataLen = len(ptyData)
	}
	if entry.FileRunLen > pos.TailRunPos {
		runData, err := t.readDataFromFile(t.Gen.RunOutFile(entry.CmdKey), pos.TailRunPos, MaxDataBytes)
		if err != nil {
			return nil, err
		}
		dataPacket.RunData64 = base64.StdEncoding.EncodeToString(runData)
		dataPacket.RunDataLen = len(runData)
	}
	return dataPacket, nil
}

// returns (data-packet, keepRunning)
func (t *Tailer) runSingleDataTransfer(key base.CommandKey, reqId string) (*packet.CmdDataPacketType, bool, error) {
	t.Lock.Lock()
	entry, pos, foundPos := t.getEntryAndPos_nolock(key, reqId)
	t.Lock.Unlock()
	if !foundPos {
		return nil, false, nil
	}
	dataPacket, dataErr := t.makeCmdDataPacket(entry, pos)

	t.Lock.Lock()
	defer t.Lock.Unlock()
	entry, pos, foundPos = t.getEntryAndPos_nolock(key, reqId)
	if !foundPos {
		return nil, false, nil
	}
	// pos was updated between first and second get, throw out data-packet and re-run
	if pos.TailPtyPos != dataPacket.PtyPos || pos.TailRunPos != dataPacket.RunPos {
		return nil, true, nil
	}
	if dataErr != nil {
		// error, so return error packet, and stop running
		pos.Running = false
		t.updateTailPos_nolock(key, reqId, pos)
		return nil, false, dataErr
	}
	pos.TailPtyPos += int64(dataPacket.PtyDataLen)
	pos.TailRunPos += int64(dataPacket.RunDataLen)
	if pos.IsCurrent(entry) {
		// we caught up, tail position equals file length
		pos.Running = false
	}
	t.updateTailPos_nolock(key, reqId, pos)
	return dataPacket, pos.Running, nil
}

// returns (removed)
func (t *Tailer) checkRemove(cmdKey base.CommandKey, reqId string) bool {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	entry, pos, foundPos := t.getEntryAndPos_nolock(cmdKey, reqId)
	if !foundPos {
		return false
	}
	if !pos.IsCurrent(entry) {
		return false
	}
	if !pos.Follow || entry.Done {
		t.removeTailPos_nolock(cmdKey, reqId)
		return true
	}
	return false
}

func (t *Tailer) RunDataTransfer(key base.CommandKey, reqId string) {
	for {
		dataPacket, keepRunning, err := t.runSingleDataTransfer(key, reqId)
		if dataPacket != nil {
			t.Sender.SendPacket(dataPacket)
		}
		if err != nil {
			t.removeTailPos(key, reqId)
			t.Sender.SendErrorResponse(reqId, err)
			break
		}
		if !keepRunning {
			removed := t.checkRemove(key, reqId)
			if removed {
				t.Sender.SendResponse(reqId, true)
			}
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

func (entry *CmdWatchEntry) fillFilePos(gen FileNameGenerator) {
	ptyInfo, _ := os.Stat(gen.PtyOutFile(entry.CmdKey))
	if ptyInfo != nil {
		entry.FilePtyLen = ptyInfo.Size()
	}
	runoutInfo, _ := os.Stat(gen.RunOutFile(entry.CmdKey))
	if runoutInfo != nil {
		entry.FileRunLen = runoutInfo.Size()
	}
}

func (t *Tailer) KeyDone(key base.CommandKey) {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	entry, foundEntry := t.WatchList[key]
	if !foundEntry {
		return
	}
	entry.Done = true
	var newTails []TailPos
	for _, pos := range entry.Tails {
		if pos.IsCurrent(entry) {
			continue
		}
		newTails = append(newTails, pos)
	}
	entry.Tails = newTails
	t.WatchList[key] = entry
	if len(entry.Tails) == 0 {
		t.removeWatch_nolock(key)
	}
	t.WatchList[key] = entry
}

func (t *Tailer) RemoveWatch(pk *packet.UntailCmdPacketType) {
	t.Lock.Lock()
	defer t.Lock.Unlock()
	t.removeTailPos_nolock(pk.CK, pk.ReqId)
}

func (t *Tailer) AddFileWatches_nolock(key base.CommandKey, ptyOnly bool) error {
	ptyName := t.Gen.PtyOutFile(key)
	runName := t.Gen.RunOutFile(key)
	fmt.Printf("WATCH> add %s\n", ptyName)
	err := t.Watcher.Add(ptyName)
	if err != nil {
		return err
	}
	if ptyOnly {
		return nil
	}
	err = t.Watcher.Add(runName)
	if err != nil {
		t.Watcher.Remove(ptyName) // best effort clean up
		return err
	}
	return nil
}

// returns (up-to-date/done, error)
func (t *Tailer) AddWatch(getPacket *packet.GetCmdPacketType) (bool, error) {
	if err := getPacket.CK.Validate("getcmd"); err != nil {
		return false, err
	}
	if getPacket.ReqId == "" {
		return false, fmt.Errorf("getcmd, no reqid specified")
	}
	t.Lock.Lock()
	defer t.Lock.Unlock()
	key := getPacket.CK
	entry, foundEntry := t.WatchList[key]
	if !foundEntry {
		// initialize entry, add watches
		entry = CmdWatchEntry{CmdKey: key}
		entry.fillFilePos(t.Gen)
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
	if !pos.Follow && pos.IsCurrent(entry) {
		// don't add to t.WatchList, don't t.AddFileWatches_nolock, send rpc response
		return true, nil
	}
	if !foundEntry {
		err := t.AddFileWatches_nolock(key, getPacket.PtyOnly)
		if err != nil {
			return false, err
		}
	}
	t.WatchList[key] = entry
	t.tryStartRun_nolock(entry, pos)
	return false, nil
}
