// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

type ConnMonitor struct {
	lock              *sync.Mutex
	Conn              *SSHConn
	LastActivityTime  atomic.Int64
	KeepAliveSentTime int64
	KeepAliveInFlight bool
	ctx               context.Context
	cancelFunc        context.CancelFunc
}

func MakeConnMonitor(conn *SSHConn) *ConnMonitor {
	ctx, cancelFunc := context.WithCancel(context.Background())
	cm := &ConnMonitor{
		lock:       &sync.Mutex{},
		Conn:       conn,
		ctx:        ctx,
		cancelFunc: cancelFunc,
	}
	go cm.keepAliveMonitor()
	return cm
}

func (cm *ConnMonitor) UpdateLastActivityTime() {
	cm.LastActivityTime.Store(time.Now().UnixMilli())
	cm.Conn.SetConnHealthStatus(ConnHealthStatus_Good)
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

func (cm *ConnMonitor) getTimeSinceKeepAlive() int64 {
	cm.lock.Lock()
	defer cm.lock.Unlock()

	if !cm.KeepAliveInFlight {
		return 0
	}
	return time.Now().UnixMilli() - cm.KeepAliveSentTime
}

func (cm *ConnMonitor) SendKeepAlive() error {
	conn := cm.Conn
	if conn == nil || conn.Client == nil {
		return fmt.Errorf("no active connection")
	}
	if !cm.setKeepAliveInFlight() {
		return nil
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:SendKeepAlive", recover())
		}()
		defer cm.clearKeepAliveInFlight()
		_, _, _ = conn.Client.SendRequest("keepalive@openssh.com", true, nil)
		cm.UpdateLastActivityTime()
	}()
	return nil
}

func (cm *ConnMonitor) keepAliveMonitor() {
	defer func() {
		panichandler.PanicHandler("conncontroller:keepAliveMonitor", recover())
	}()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			lastActivity := cm.LastActivityTime.Load()
			if lastActivity == 0 {
				continue
			}
			timeSinceActivity := time.Now().UnixMilli() - lastActivity
			if timeSinceActivity > 10000 {
				cm.SendKeepAlive()
				timeSinceKeepAlive := cm.getTimeSinceKeepAlive()
				if timeSinceKeepAlive > 10000 {
					cm.Conn.SetConnHealthStatus(ConnHealthStatus_Stalled)
				}
			}
		case <-cm.ctx.Done():
			return
		}
	}
}

func (cm *ConnMonitor) Close() {
	if cm.cancelFunc != nil {
		cm.cancelFunc()
	}
}
