// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmdrunner

import (
	"context"
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/remote"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/scpacket"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
)

const (
	R_Session         = 1
	R_Screen          = 2
	R_Remote          = 8
	R_RemoteConnected = 16
)

type resolvedIds struct {
	SessionId string
	ScreenId  string
	Remote    *ResolvedRemote
}

type ResolvedRemote struct {
	DisplayName string
	RemotePtr   sstore.RemotePtrType
	MShell      *remote.MShellProc
	RState      remote.RemoteRuntimeState
	RemoteCopy  *sstore.RemoteType
	ShellType   string
	StatePtr    *sstore.ShellStatePtr
	FeState     map[string]string
}

type ResolveItem = sstore.ResolveItem

func itemNames(items []ResolveItem) []string {
	if len(items) == 0 {
		return nil
	}
	rtn := make([]string, len(items))
	for idx, item := range items {
		rtn[idx] = item.Name
	}
	return rtn
}

func sessionsToResolveItems(sessions []*sstore.SessionType) []ResolveItem {
	if len(sessions) == 0 {
		return nil
	}
	rtn := make([]ResolveItem, len(sessions))
	for idx, session := range sessions {
		rtn[idx] = ResolveItem{Name: session.Name, Id: session.SessionId, Hidden: session.Archived}
	}
	return rtn
}

func screensToResolveItems(screens []*sstore.ScreenType) []ResolveItem {
	if len(screens) == 0 {
		return nil
	}
	rtn := make([]ResolveItem, len(screens))
	for idx, screen := range screens {
		rtn[idx] = ResolveItem{Name: screen.Name, Id: screen.ScreenId, Hidden: screen.Archived}
	}
	return rtn
}

// 1-indexed
func boundInt(ival int, maxVal int, wrap bool) int {
	if maxVal == 0 {
		return 0
	}
	if ival < 1 {
		if wrap {
			return maxVal
		} else {
			return 1
		}
	}
	if ival > maxVal {
		if wrap {
			return 1
		} else {
			return maxVal
		}
	}
	return ival
}

type posArgType struct {
	Pos         int
	IsWrap      bool
	IsRelative  bool
	StartAnchor bool
	EndAnchor   bool
}

func parsePosArg(posStr string) *posArgType {
	if !positionRe.MatchString(posStr) {
		return nil
	}
	if posStr == "+" {
		return &posArgType{Pos: 1, IsWrap: true, IsRelative: true}
	} else if posStr == "-" {
		return &posArgType{Pos: -1, IsWrap: true, IsRelative: true}
	} else if posStr == "S" {
		return &posArgType{Pos: 0, IsRelative: true, StartAnchor: true}
	} else if posStr == "E" {
		return &posArgType{Pos: 0, IsRelative: true, EndAnchor: true}
	}
	if strings.HasPrefix(posStr, "S+") {
		pos, _ := strconv.Atoi(posStr[2:])
		return &posArgType{Pos: pos, IsRelative: true, StartAnchor: true}
	}
	if strings.HasPrefix(posStr, "E-") {
		pos, _ := strconv.Atoi(posStr[1:])
		return &posArgType{Pos: pos, IsRelative: true, EndAnchor: true}
	}
	if strings.HasPrefix(posStr, "+") || strings.HasPrefix(posStr, "-") {
		pos, _ := strconv.Atoi(posStr)
		return &posArgType{Pos: pos, IsRelative: true}
	}
	pos, _ := strconv.Atoi(posStr)
	return &posArgType{Pos: pos}
}

func resolveByPosition(isNumeric bool, allItems []ResolveItem, curId string, posStr string) *ResolveItem {
	items := make([]ResolveItem, 0, len(allItems))
	for _, item := range allItems {
		if !item.Hidden {
			items = append(items, item)
		}
	}
	if len(items) == 0 {
		return nil
	}
	posArg := parsePosArg(posStr)
	if posArg == nil {
		return nil
	}
	var finalPos int
	if posArg.IsRelative {
		var curIdx int
		if posArg.StartAnchor {
			curIdx = 1
		} else if posArg.EndAnchor {
			curIdx = len(items)
		} else {
			curIdx = 1 // if no match, curIdx will be first item
			for idx, item := range items {
				if item.Id == curId {
					curIdx = idx + 1
					break
				}
			}
		}
		finalPos = curIdx + posArg.Pos
		finalPos = boundInt(finalPos, len(items), posArg.IsWrap)
		return &items[finalPos-1]
	} else if isNumeric {
		// these resolve items have a "Num" set that should be used to look up non-relative positions
		// use allItems for numeric resolve
		for _, item := range allItems {
			if item.Num == posArg.Pos {
				return &item
			}
		}
		return nil
	} else {
		// non-numeric means position is just the index
		finalPos = posArg.Pos
		if finalPos <= 0 || finalPos > len(items) {
			return nil
		}
		return &items[finalPos-1]
	}
}

func resolveRemoteArg(remoteArg string) (*sstore.RemotePtrType, error) {
	rrUser, rrRemote, rrName, err := parseFullRemoteRef(remoteArg)
	if err != nil {
		return nil, err
	}
	if rrUser != "" {
		return nil, fmt.Errorf("remoteusers not supported")
	}
	msh := remote.GetRemoteByArg(rrRemote)
	if msh == nil {
		return nil, nil
	}
	rcopy := msh.GetRemoteCopy()
	return &sstore.RemotePtrType{RemoteId: rcopy.RemoteId, Name: rrName}, nil
}

func resolveUiIds(ctx context.Context, pk *scpacket.FeCommandPacketType, rtype int) (resolvedIds, error) {
	rtn := resolvedIds{}
	uictx := pk.UIContext
	if uictx != nil {
		rtn.SessionId = uictx.SessionId
		rtn.ScreenId = uictx.ScreenId
	}
	if pk.Kwargs["session"] != "" {
		sessionId, err := resolveSessionArg(pk.Kwargs["session"])
		if err != nil {
			return rtn, err
		}
		if sessionId != "" {
			rtn.SessionId = sessionId
		}
	}
	if pk.Kwargs["screen"] != "" {
		screenId, err := resolveScreenArg(rtn.SessionId, pk.Kwargs["screen"])
		if err != nil {
			return rtn, err
		}
		if screenId != "" {
			rtn.ScreenId = screenId
		}
	}
	var rptr *sstore.RemotePtrType
	var err error
	if pk.Kwargs["remote"] != "" {
		rptr, err = resolveRemoteArg(pk.Kwargs["remote"])
		if err != nil {
			return rtn, err
		}
		if rptr == nil {
			return rtn, fmt.Errorf("invalid remote argument %q passed, remote not found", pk.Kwargs["remote"])
		}
	} else if uictx.Remote != nil {
		rptr = uictx.Remote
	}
	if rptr != nil {
		err = rptr.Validate()
		if err != nil {
			return rtn, fmt.Errorf("invalid resolved remote: %v", err)
		}
		rr, err := ResolveRemoteFromPtr(ctx, rptr, rtn.SessionId, rtn.ScreenId)
		if err != nil {
			return rtn, err
		}
		rtn.Remote = rr
	}
	if rtype&R_Session > 0 && rtn.SessionId == "" {
		return rtn, fmt.Errorf("no session")
	}
	if rtype&R_Screen > 0 && rtn.ScreenId == "" {
		return rtn, fmt.Errorf("no screen")
	}
	if (rtype&R_Remote > 0 || rtype&R_RemoteConnected > 0) && rtn.Remote == nil {
		return rtn, fmt.Errorf("no remote")
	}
	if rtype&R_RemoteConnected > 0 {
		log.Printf("COLE TEST remote: %v\n", rtn.Remote)
		log.Printf("COLE TEST remote state: %v\n", rtn.Remote.StatePtr)
		log.Printf("COLE TEST remote fe state: %v\n", rtn.Remote.FeState)
		allRemotes, err := sstore.GetAllRemotes(ctx)
		if err != nil {
			log.Printf("COLE TEST error getting all remotes: %v", err)
		}
		log.Printf("COLE TEST listing all remotes\n")
		for index := 0; index < len(allRemotes); index++ {
			curRemote := allRemotes[index]
			log.Printf("remoteID: %v, remoteAlias: %v\n", curRemote.RemoteId, curRemote.RemoteAlias)
			log.Printf("\tremoteCanonicalName: %v remoteType: %v", curRemote.RemoteCanonicalName, curRemote.RemoteType)
			log.Printf("\tisLocal: %v", curRemote.Local)
		}
		if !rtn.Remote.RState.IsConnected() {
			err = rtn.Remote.MShell.TryAutoConnect()
			if err != nil {
				return rtn, fmt.Errorf("error trying to auto-connect remote [%s]: %w", rtn.Remote.DisplayName, err)
			}
			rrNew, err := ResolveRemoteFromPtr(ctx, rptr, rtn.SessionId, rtn.ScreenId)
			if err != nil {
				return rtn, err
			}
			rtn.Remote = rrNew
		}
		if !rtn.Remote.RState.IsConnected() {
			return rtn, fmt.Errorf("remote [%s] is not connected", rtn.Remote.DisplayName)
		}
		if rtn.Remote.StatePtr == nil || rtn.Remote.FeState == nil {
			return rtn, fmt.Errorf("remote [%s] state is not available", rtn.Remote.DisplayName)
		}
	}
	return rtn, nil
}

func resolveSessionScreen(ctx context.Context, sessionId string, screenArg string, curScreenArg string) (*ResolveItem, error) {
	screens, err := sstore.GetSessionScreens(ctx, sessionId)
	if err != nil {
		return nil, fmt.Errorf("could not retreive screens for session=%s: %v", sessionId, err)
	}
	ritems := screensToResolveItems(screens)
	return genericResolve(screenArg, curScreenArg, ritems, false, "screen")
}

func resolveSession(ctx context.Context, sessionArg string, curSessionArg string) (*ResolveItem, error) {
	bareSessions, err := sstore.GetBareSessions(ctx)
	if err != nil {
		return nil, err
	}
	ritems := sessionsToResolveItems(bareSessions)
	ritem, err := genericResolve(sessionArg, curSessionArg, ritems, false, "session")
	if err != nil {
		return nil, err
	}
	return ritem, nil
}

func resolveLine(ctx context.Context, sessionId string, screenId string, lineArg string, curLineArg string) (*ResolveItem, error) {
	lines, err := sstore.GetLineResolveItems(ctx, screenId)
	if err != nil {
		return nil, fmt.Errorf("could not get lines: %v", err)
	}
	return genericResolve(lineArg, curLineArg, lines, true, "line")
}

func getSessionIds(sarr []*sstore.SessionType) []string {
	rtn := make([]string, len(sarr))
	for idx, s := range sarr {
		rtn[idx] = s.SessionId
	}
	return rtn
}

var partialUUIDRe = regexp.MustCompile("^[0-9a-f]{8}$")

func isPartialUUID(s string) bool {
	return partialUUIDRe.MatchString(s)
}

func isUUID(s string) bool {
	_, err := uuid.Parse(s)
	return err == nil
}

func getResolveItemById(id string, items []ResolveItem) *ResolveItem {
	if id == "" {
		return nil
	}
	for _, item := range items {
		if item.Id == id {
			return &item
		}
	}
	return nil
}

func genericResolve(arg string, curArg string, items []ResolveItem, isNumeric bool, typeStr string) (*ResolveItem, error) {
	if len(items) == 0 || arg == "" {
		return nil, nil
	}
	var curId string
	if curArg != "" {
		curItem, _ := genericResolve(curArg, "", items, isNumeric, typeStr)
		if curItem != nil {
			curId = curItem.Id
		}
	}
	rtnItem := resolveByPosition(isNumeric, items, curId, arg)
	if rtnItem != nil {
		return rtnItem, nil
	}
	isUuid := isUUID(arg)
	tryPuid := isPartialUUID(arg)
	var prefixMatches []ResolveItem
	for _, item := range items {
		if (isUuid && item.Id == arg) || (tryPuid && strings.HasPrefix(item.Id, arg)) {
			return &item, nil
		}
		if item.Name != "" {
			if item.Name == arg {
				return &item, nil
			}
			if !item.Hidden && strings.HasPrefix(item.Name, arg) {
				prefixMatches = append(prefixMatches, item)
			}
		}
	}
	if len(prefixMatches) == 1 {
		return &prefixMatches[0], nil
	}
	if len(prefixMatches) > 1 {
		return nil, fmt.Errorf("could not resolve %s '%s', ambiguious prefix matched multiple %ss: %s", typeStr, arg, typeStr, formatStrs(itemNames(prefixMatches), "and", true))
	}
	return nil, fmt.Errorf("could not resolve %s '%s' (name/id/pos not found)", typeStr, arg)
}

func resolveSessionId(pk *scpacket.FeCommandPacketType) (string, error) {
	sessionId := pk.Kwargs["session"]
	if sessionId == "" {
		return "", nil
	}
	if _, err := uuid.Parse(sessionId); err != nil {
		return "", fmt.Errorf("invalid sessionid '%s'", sessionId)
	}
	return sessionId, nil
}

func resolveSessionArg(sessionArg string) (string, error) {
	if sessionArg == "" {
		return "", nil
	}
	if _, err := uuid.Parse(sessionArg); err != nil {
		return "", fmt.Errorf("invalid session arg specified (must be sessionid) '%s'", sessionArg)
	}
	return sessionArg, nil
}

func resolveScreenArg(sessionId string, screenArg string) (string, error) {
	if screenArg == "" {
		return "", nil
	}
	if _, err := uuid.Parse(screenArg); err != nil {
		return "", fmt.Errorf("invalid screen arg specified (must be screenid) '%s'", screenArg)
	}
	return screenArg, nil
}

func resolveScreenId(ctx context.Context, pk *scpacket.FeCommandPacketType, sessionId string) (string, error) {
	screenArg := pk.Kwargs["screen"]
	if screenArg == "" {
		return "", nil
	}
	if _, err := uuid.Parse(screenArg); err == nil {
		return screenArg, nil
	}
	if sessionId == "" {
		return "", fmt.Errorf("cannot resolve screen without session")
	}
	ritem, err := resolveSessionScreen(ctx, sessionId, screenArg, "")
	if err != nil {
		return "", err
	}
	return ritem.Id, nil
}

// returns (remoteuserref, remoteref, name, error)
func parseFullRemoteRef(fullRemoteRef string) (string, string, string, error) {
	if strings.HasPrefix(fullRemoteRef, "[") && strings.HasSuffix(fullRemoteRef, "]") {
		fullRemoteRef = fullRemoteRef[1 : len(fullRemoteRef)-1]
	}
	fields := strings.Split(fullRemoteRef, ":")
	if len(fields) > 3 {
		return "", "", "", fmt.Errorf("invalid remote format '%s'", fullRemoteRef)
	}
	if len(fields) == 1 {
		return "", fields[0], "", nil
	}
	if len(fields) == 2 {
		if strings.HasPrefix(fields[0], "@") {
			return fields[0], fields[1], "", nil
		}
		return "", fields[0], fields[1], nil
	}
	return fields[0], fields[1], fields[2], nil
}

func ResolveRemoteFromPtr(ctx context.Context, rptr *sstore.RemotePtrType, sessionId string, screenId string) (*ResolvedRemote, error) {
	if rptr == nil || rptr.RemoteId == "" {
		return nil, nil
	}
	msh := remote.GetRemoteById(rptr.RemoteId)
	if msh == nil {
		return nil, fmt.Errorf("invalid remote '%s', not found", rptr.RemoteId)
	}
	rstate := msh.GetRemoteRuntimeState()
	rcopy := msh.GetRemoteCopy()
	displayName := rstate.GetDisplayName(rptr)
	rtn := &ResolvedRemote{
		DisplayName: displayName,
		RemotePtr:   *rptr,
		RState:      rstate,
		MShell:      msh,
		RemoteCopy:  &rcopy,
		StatePtr:    nil,
		FeState:     nil,
		ShellType:   "",
	}
	if sessionId != "" && screenId != "" {
		ri, err := sstore.GetRemoteInstance(ctx, sessionId, screenId, *rptr)
		if err != nil {
			log.Printf("ERROR resolving remote state '%s': %v\n", displayName, err)
			// continue with state set to nil
		} else {
			log.Printf("COLE TEST here is where we get remote state from an sstore.GetRemoteInstance call")
			if ri == nil {
				rtn.ShellType = msh.GetShellPref()
				rtn.StatePtr = msh.GetDefaultStatePtr(rtn.ShellType)
				rtn.FeState = msh.GetDefaultFeState(rtn.ShellType)
				log.Printf("COLE TEST Remote instance is null, getting defaults - statePtr: %v = feState: %v", rtn.StatePtr, rtn.FeState)
			} else {
				rtn.StatePtr = &sstore.ShellStatePtr{BaseHash: ri.StateBaseHash, DiffHashArr: ri.StateDiffHashArr}
				rtn.FeState = ri.FeState
				rtn.ShellType = ri.ShellType
				log.Printf("COLE TEST Copying state from remote instance - StatePtr: %v - feState: %v", rtn.StatePtr, rtn.FeState)
			}
		}
	}
	return rtn, nil
}

// returns (remoteDisplayName, remoteptr, state, rstate, err)
func resolveRemote(ctx context.Context, fullRemoteRef string, sessionId string, screenId string) (string, *sstore.RemotePtrType, *remote.RemoteRuntimeState, error) {
	if fullRemoteRef == "" {
		return "", nil, nil, nil
	}
	userRef, remoteRef, remoteName, err := parseFullRemoteRef(fullRemoteRef)
	if err != nil {
		return "", nil, nil, err
	}
	if userRef != "" {
		return "", nil, nil, fmt.Errorf("invalid remote '%s', cannot resolve remote userid '%s'", fullRemoteRef, userRef)
	}
	rstate := remote.ResolveRemoteRef(remoteRef)
	if rstate == nil {
		return "", nil, nil, fmt.Errorf("cannot resolve remote '%s': not found", fullRemoteRef)
	}
	rptr := sstore.RemotePtrType{RemoteId: rstate.RemoteId, Name: remoteName}
	rname := rstate.RemoteCanonicalName
	if rstate.RemoteAlias != "" {
		rname = rstate.RemoteAlias
	}
	if rptr.Name != "" {
		rname = fmt.Sprintf("%s:%s", rname, rptr.Name)
	}
	return rname, &rptr, rstate, nil
}
