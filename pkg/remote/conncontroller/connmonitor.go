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
	LastInputTime     atomic.Int64
	KeepAliveSentTime atomic.Int64
	KeepAliveInFlight bool
	ctx               context.Context
	cancelFunc        context.CancelFunc
	inputNotifyCh     chan int64
}

func MakeConnMonitor(conn *SSHConn) *ConnMonitor {
	ctx, cancelFunc := context.WithCancel(context.Background())
	cm := &ConnMonitor{
		lock:          &sync.Mutex{},
		Conn:          conn,
		ctx:           ctx,
		cancelFunc:    cancelFunc,
		inputNotifyCh: make(chan int64, 1),
	}
	go cm.keepAliveMonitor()
	return cm
}

func (cm *ConnMonitor) UpdateLastActivityTime() {
	cm.LastActivityTime.Store(time.Now().UnixMilli())
	cm.Conn.SetConnHealthStatus(ConnHealthStatus_Good)
}

func (cm *ConnMonitor) NotifyInput() {
	inputTime := time.Now().UnixMilli()
	cm.LastInputTime.Store(inputTime)
	select {
	case cm.inputNotifyCh <- inputTime:
	default:
	}
}

func (cm *ConnMonitor) isUrgent() bool {
	lastInput := cm.LastInputTime.Load()
	if lastInput == 0 {
		return false
	}
	return time.Now().UnixMilli()-lastInput < 10000
}

func (cm *ConnMonitor) setKeepAliveInFlight() bool {
	cm.lock.Lock()
	defer cm.lock.Unlock()

	if cm.KeepAliveInFlight {
		return false
	}
	cm.KeepAliveInFlight = true
	cm.KeepAliveSentTime.Store(time.Now().UnixMilli())
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
	return time.Now().UnixMilli() - cm.KeepAliveSentTime.Load()
}

func (cm *ConnMonitor) SendKeepAlive() error {
	conn := cm.Conn
	client := conn.GetClient()
	if conn == nil || client == nil {
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
		_, _, _ = client.SendRequest("keepalive@openssh.com", true, nil)
		cm.UpdateLastActivityTime()
	}()
	return nil
}

func (cm *ConnMonitor) checkConnection() {
	lastActivity := cm.LastActivityTime.Load()
	if lastActivity == 0 {
		return
	}
	urgent := cm.isUrgent()
	timeSinceActivity := time.Now().UnixMilli() - lastActivity

	keepAliveThreshold := int64(10000)
	if urgent {
		keepAliveThreshold = 1000
	}
	if timeSinceActivity > keepAliveThreshold {
		cm.SendKeepAlive()
	}

	stalledThreshold := int64(10000)
	if urgent {
		stalledThreshold = 5000
	}
	timeSinceKeepAlive := cm.getTimeSinceKeepAlive()
	if timeSinceKeepAlive > stalledThreshold {
		cm.Conn.SetConnHealthStatus(ConnHealthStatus_Stalled)
	}
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
			cm.checkConnection()

		case inputTime := <-cm.inputNotifyCh:
			select {
			case <-time.After(1 * time.Second):
				if cm.LastActivityTime.Load() >= inputTime {
					break
				}
				cm.Conn.SetConnHealthStatus(ConnHealthStatus_Degraded)
				cm.checkConnection()
			case <-cm.ctx.Done():
				return
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
