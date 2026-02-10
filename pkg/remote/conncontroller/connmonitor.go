// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"golang.org/x/crypto/ssh"
)

// Lock ordering: conn.lock > cm.lock (conn.lock is outer, cm.lock is inner)
// CRITICAL: Methods that hold cm.lock must NEVER call into SSHConn (deadlock - violates ordering).
// Methods called from SSHConn while conn.lock is held should avoid acquiring cm.lock (keep locking simple).
type ConnMonitor struct {
	lock              *sync.Mutex
	Conn              *SSHConn    // always non-nil, set at creation
	Client            *ssh.Client // always non-nil, set at creation
	LastActivityTime  atomic.Int64
	LastInputTime     atomic.Int64
	KeepAliveSentTime atomic.Int64
	KeepAliveInFlight bool
	ctx               context.Context
	cancelFunc        context.CancelFunc
	inputNotifyCh     chan int64
}

func MakeConnMonitor(conn *SSHConn, client *ssh.Client) *ConnMonitor {
	if conn == nil {
		panic("conn cannot be nil")
	}
	if client == nil {
		panic("client cannot be nil")
	}
	ctx, cancelFunc := context.WithCancel(context.Background())
	cm := &ConnMonitor{
		lock:          &sync.Mutex{},
		Conn:          conn,
		Client:        client,
		ctx:           ctx,
		cancelFunc:    cancelFunc,
		inputNotifyCh: make(chan int64, 1),
	}
	go cm.keepAliveMonitor()
	return cm
}

// setConnHealthStatus calls into SSHConn.SetConnHealthStatus
// CRITICAL: cm.lock must NOT be held when calling this method (violates lock ordering)
func (cm *ConnMonitor) setConnHealthStatus(status string) {
	cm.Conn.SetConnHealthStatus(cm.Client, status)
}

func (cm *ConnMonitor) UpdateLastActivityTime() {
	cm.LastActivityTime.Store(time.Now().UnixMilli())
	cm.setConnHealthStatus(ConnHealthStatus_Good)
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
	client := cm.Client
	if !cm.setKeepAliveInFlight() {
		return nil
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:SendKeepAlive", recover())
		}()
		defer cm.clearKeepAliveInFlight()
		startTime := time.Now()
		_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
		if err != nil {
			// errors are only returned for network and I/O issues (likely disconnection). do not update last activity time
			duration := time.Since(startTime).Milliseconds()
			log.Printf("[conncontroller] conn:%s keepalive error (duration=%dms): %v", cm.Conn.GetName(), duration, err)
			return
		}
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
		cm.setConnHealthStatus(ConnHealthStatus_Stalled)
	}
}

func (cm *ConnMonitor) keepAliveMonitor() {
	defer func() {
		panichandler.PanicHandler("conncontroller:keepAliveMonitor", recover())
	}()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		// check if our client is still the active one
		if cm.Conn.GetClient() != cm.Client {
			return
		}

		select {
		case <-ticker.C:
			cm.checkConnection()

		case inputTime := <-cm.inputNotifyCh:
			select {
			case <-time.After(1 * time.Second):
				if cm.LastActivityTime.Load() >= inputTime {
					break
				}
				cm.setConnHealthStatus(ConnHealthStatus_Degraded)
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
