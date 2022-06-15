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
	"path"
	"regexp"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/google/uuid"
	"github.com/scripthaus-dev/sh2-runner/pkg/base"
	"github.com/scripthaus-dev/sh2-runner/pkg/packet"
)

const MaxDataBytes = 4096

type TailPos struct {
	CmdKey     CmdKey
	Running    bool // an active tailer sending data
	Version    int
	FilePtyLen int64
	FileRunLen int64
	TailPtyPos int64
	TailRunPos int64
}

type CmdKey struct {
	SessionId string
	CmdId     string
}

type Tailer struct {
	Lock      *sync.Mutex
	WatchList map[CmdKey]TailPos
	Sessions  map[string]bool
	Watcher   *fsnotify.Watcher
	ScHomeDir string
	Sender    *packet.PacketSender
}

func MakeTailer(sender *packet.PacketSender) (*Tailer, error) {
	scHomeDir, err := base.GetScHomeDir()
	if err != nil {
		return nil, err
	}
	rtn := &Tailer{
		Lock:      &sync.Mutex{},
		WatchList: make(map[CmdKey]TailPos),
		Sessions:  make(map[string]bool),
		ScHomeDir: scHomeDir,
		Sender:    sender,
	}
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

var updateFileRe = regexp.MustCompile("/([a-z0-9-]+)/([a-z0-9-]+)\\.(ptyout|runout)$")

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

func (t *Tailer) RunDataTransfer(key CmdKey) {
	for {
		dataPacket, keepRunning := t.runSingleDataTransfer(key)
		if dataPacket != nil {
			t.Sender.SendPacket(dataPacket)
		}
		if !keepRunning {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (t *Tailer) UpdateFile(relFileName string) {
	m := updateFileRe.FindStringSubmatch(relFileName)
	if m == nil {
		return
	}
	finfo, err := os.Stat(relFileName)
	if err != nil {
		t.Sender.SendMessage("error stating file '%s': %w", relFileName, err)
		return
	}
	isPtyFile := m[3] == "ptyout"
	cmdKey := CmdKey{m[1], m[2]}
	fileSize := finfo.Size()
	t.Lock.Lock()
	defer t.Lock.Unlock()
	pos, foundPos := t.WatchList[cmdKey]
	if !foundPos {
		return
	}
	if isPtyFile {
		pos.FilePtyLen = fileSize
	} else {
		pos.FileRunLen = fileSize
	}
	t.WatchList[cmdKey] = pos
	if !pos.Running && (pos.FilePtyLen > pos.TailPtyPos || pos.FileRunLen > pos.TailRunPos) {
		go t.RunDataTransfer(cmdKey)
	}
}

func (t *Tailer) Run() {
	for {
		select {
		case event, ok := <-t.Watcher.Events:
			if !ok {
				return
			}
			if (event.Op&fsnotify.Write == fsnotify.Write) || (event.Op&fsnotify.Create == fsnotify.Create) {
				t.UpdateFile(event.Name)
			}

		case err, ok := <-t.Watcher.Errors:
			if !ok {
				return
			}
			// what to do with watcher error?
			t.Sender.SendMessage("error in tailer '%v'", err)
		}
	}
}

func (tp *TailPos) fillFilePos(scHomeDir string) {
	fileNames := base.MakeCommandFileNamesWithHome(scHomeDir, tp.CmdKey.SessionId, tp.CmdKey.CmdId)
	ptyInfo, _ := os.Stat(fileNames.PtyOutFile)
	if ptyInfo != nil {
		tp.FilePtyLen = ptyInfo.Size()
	}
	runoutInfo, _ := os.Stat(fileNames.RunnerOutFile)
	if runoutInfo != nil {
		tp.FileRunLen = runoutInfo.Size()
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
	if !t.Sessions[getPacket.SessionId] {
		sessionDir := path.Join(t.ScHomeDir, base.SessionsDirBaseName, getPacket.SessionId)
		err = t.Watcher.Add(sessionDir)
		if err != nil {
			return fmt.Errorf("error adding watcher for session dir '%s': %v", sessionDir, err)
		}
		t.Sessions[getPacket.SessionId] = true
	}
	oldPos := t.WatchList[key]
	pos := TailPos{CmdKey: key, TailPtyPos: getPacket.PtyPos, TailRunPos: getPacket.RunPos, Version: oldPos.Version + 1}
	pos.fillFilePos(t.ScHomeDir)
	t.WatchList[key] = pos
	return nil
}
