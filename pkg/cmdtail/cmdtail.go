// Copyright 2022 Dashborg Inc
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

package cmdtail

import (
	"sync"

	"github.com/fsnotify/fsnotify"
	"github.com/scripthaus-dev/sh2-runner/pkg/packet"
)

type TailPos struct {
	CmdKey    CmdKey
	Pos       int
	RunOut    bool
	RunOutPos int
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
}

func MakeTailer() (*Tailer, error) {
	rtn := &Tailer{
		Lock:      &sync.Mutex{},
		WatchList: make(map[CmdKey]TailPos),
		Sessions:  make(map[string]bool),
	}
	var err error
	rtn.Watcher, err = fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func AddWatch(getPacket *packet.GetCmdPacketType) error {
	return nil
}
