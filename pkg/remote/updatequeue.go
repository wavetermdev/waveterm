package remote

import (
	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
)

func pushCmdWaitIfRequired(ck base.CommandKey, update sstore.UpdatePacket) bool {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()
	updates, ok := GlobalStore.CmdWaitMap[ck]
	if !ok {
		return false
	}
	updates = append(updates, update)
	GlobalStore.CmdWaitMap[ck] = updates
	return true
}

func sendCmdUpdate(ck base.CommandKey, update sstore.UpdatePacket) {
	pushed := pushCmdWaitIfRequired(ck, update)
	if pushed {
		return
	}
	sstore.MainBus.SendUpdate(ck.GetSessionId(), update)
}

func runCmdWaitUpdates(ck base.CommandKey) {
	for {
		update := removeFirstCmdWaitUpdate(ck)
		if update == nil {
			break
		}
		sstore.MainBus.SendUpdate(ck.GetSessionId(), update)
	}
}

func removeFirstCmdWaitUpdate(ck base.CommandKey) sstore.UpdatePacket {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()

	updates := GlobalStore.CmdWaitMap[ck]
	if len(updates) == 0 {
		delete(GlobalStore.CmdWaitMap, ck)
		return nil
	}
	if len(updates) == 1 {
		delete(GlobalStore.CmdWaitMap, ck)
		return updates[0]
	}
	update := updates[0]
	GlobalStore.CmdWaitMap[ck] = updates[1:]
	return update
}

func removeCmdWait(ck base.CommandKey) {
	GlobalStore.Lock.Lock()
	defer GlobalStore.Lock.Unlock()

	updates := GlobalStore.CmdWaitMap[ck]
	if len(updates) == 0 {
		delete(GlobalStore.CmdWaitMap, ck)
		return
	}
	go runCmdWaitUpdates(ck)
}
