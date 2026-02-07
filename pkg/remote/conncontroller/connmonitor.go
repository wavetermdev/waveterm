// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

type ConnMonitor struct {
	lock              *sync.Mutex
	Conn              *SSHConn
	LastActivityTime  atomic.Int64
	KeepAliveSentTime int64
	KeepAliveInFlight bool
}

func MakeConnMonitor(conn *SSHConn) *ConnMonitor {
	return &ConnMonitor{
		lock: &sync.Mutex{},
		Conn: conn,
	}
}

func (cm *ConnMonitor) UpdateLastActivityTime() {
	cm.LastActivityTime.Store(time.Now().UnixMilli())
}

func (cm *ConnMonitor) setKeepAliveInFlight() bool {
	cm.lock.Lock()
	defer cm.lock.Unlock()

	if cm.KeepAliveInFlight {
		return false
	}
	cm.KeepAliveInFlight = true
	cm.KeepAliveSentTime = time.Now().UnixMilli()
	return true
}

func (cm *ConnMonitor) clearKeepAliveInFlight() {
	cm.lock.Lock()
	defer cm.lock.Unlock()

	cm.KeepAliveInFlight = false
}

func (cm *ConnMonitor) SendKeepAlive() error {
	conn := cm.Conn
	if conn == nil || conn.Client == nil {
		return fmt.Errorf("no active connection")
	}
	if !cm.setKeepAliveInFlight() {
		return nil
	}
	_, _, err := conn.Client.SendRequest("keepalive@openssh.com", true, nil)
	cm.clearKeepAliveInFlight()
	if err != nil {
		return err
	}
	cm.UpdateLastActivityTime()
	return nil
}
