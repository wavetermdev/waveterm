package cmdrunner

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/scripthaus-dev/sh2-server/pkg/remote"
	"github.com/scripthaus-dev/sh2-server/pkg/scpacket"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
)

const (
	R_Session         = 1
	R_Screen          = 2
	R_Window          = 4
	R_Remote          = 8
	R_RemoteConnected = 16
)

type resolvedIds struct {
	SessionId string
	ScreenId  string
	WindowId  string
	Remote    *ResolvedRemote
}

type ResolvedRemote struct {
	DisplayName string
	RemotePtr   sstore.RemotePtrType
	MShell      *remote.MShellProc
	RState      remote.RemoteRuntimeState
	RemoteState *sstore.RemoteState
	RemoteCopy  *sstore.RemoteType
}

type ResolveItem struct {
	Name string
	Id   string
}

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
		rtn[idx] = ResolveItem{Name: session.Name, Id: session.SessionId}
	}
	return rtn
}

func screensToResolveItems(screens []*sstore.ScreenType) []ResolveItem {
	if len(screens) == 0 {
		return nil
	}
	rtn := make([]ResolveItem, len(screens))
	for idx, screen := range screens {
		rtn[idx] = ResolveItem{Name: screen.Name, Id: screen.ScreenId}
	}
	return rtn
}

func resolveByPosition(items []ResolveItem, curId string, posStr string) *ResolveItem {
	if len(items) == 0 {
		return nil
	}
	if !positionRe.MatchString(posStr) {
		return nil
	}
	curIdx := 1 // if no match, curIdx will be first item
	for idx, item := range items {
		if item.Id == curId {
			curIdx = idx + 1
			break
		}
	}
	isRelative := strings.HasPrefix(posStr, "+") || strings.HasPrefix(posStr, "-")
	isWrap := posStr == "+" || posStr == "-"
	var pos int
	if isWrap && posStr == "+" {
		pos = 1
	} else if isWrap && posStr == "-" {
		pos = -1
	} else {
		pos, _ = strconv.Atoi(posStr)
	}
	if isRelative {
		pos = curIdx + pos
	}
	if pos < 1 {
		if isWrap {
			pos = len(items)
		} else {
			pos = 1
		}
	}
	if pos > len(items) {
		if isWrap {
			pos = 1
		} else {
			pos = len(items)
		}
	}
	return &items[pos-1]
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
		rtn.WindowId = uictx.WindowId
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
	if pk.Kwargs["window"] != "" {
		windowId, err := resolveWindowArg(rtn.SessionId, rtn.ScreenId, pk.Kwargs["window"])
		if err != nil {
			return rtn, err
		}
		if windowId != "" {
			rtn.WindowId = windowId
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
		rr, err := resolveRemoteFromPtr(ctx, rptr, rtn.SessionId, rtn.WindowId)
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
	if rtype&R_Window > 0 && rtn.WindowId == "" {
		return rtn, fmt.Errorf("no window")
	}
	if (rtype&R_Remote > 0 || rtype&R_RemoteConnected > 0) && rtn.Remote == nil {
		return rtn, fmt.Errorf("no remote")
	}
	if rtype&R_RemoteConnected > 0 {
		if !rtn.Remote.RState.IsConnected() {
			return rtn, fmt.Errorf("remote '%s' is not connected", rtn.Remote.DisplayName)
		}
		if rtn.Remote.RemoteState == nil {
			return rtn, fmt.Errorf("remote '%s' state is not available", rtn.Remote.DisplayName)
		}
	}
	return rtn, nil
}

func resolveSessionScreen(ctx context.Context, sessionId string, screenArg string, curScreenArg string) (*ResolveItem, error) {
	screens, err := sstore.GetSessionScreens(ctx, sessionId)
	if err != nil {
		return nil, fmt.Errorf("could not retreive screens for session=%s", sessionId)
	}
	ritems := screensToResolveItems(screens)
	return genericResolve(screenArg, curScreenArg, ritems, "screen")
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

func genericResolve(arg string, curArg string, items []ResolveItem, typeStr string) (*ResolveItem, error) {
	var curId string
	if curArg != "" {
		curItem, _ := genericResolve(curArg, "", items, typeStr)
		if curItem != nil {
			curId = curItem.Id
		}
	}
	rtnItem := resolveByPosition(items, curId, arg)
	if rtnItem != nil {
		return rtnItem, nil
	}
	tryPuid := isPartialUUID(arg)
	var prefixMatches []ResolveItem
	for _, item := range items {
		if item.Id == arg || item.Name == arg || (tryPuid && strings.HasPrefix(item.Id, arg)) {
			return &item, nil
		}
		if strings.HasPrefix(item.Name, arg) {
			prefixMatches = append(prefixMatches, item)
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

func resolveWindowArg(sessionId string, screenId string, windowArg string) (string, error) {
	if windowArg == "" {
		return "", nil
	}
	if _, err := uuid.Parse(windowArg); err != nil {
		return "", fmt.Errorf("invalid window arg specified (must be windowid) '%s'", windowArg)
	}
	return windowArg, nil
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
		return "", fmt.Errorf("invalid screen arg specified (must be sessionid) '%s'", screenArg)
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

func resolveRemoteFromPtr(ctx context.Context, rptr *sstore.RemotePtrType, sessionId string, windowId string) (*ResolvedRemote, error) {
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
		RemoteState: nil,
		RState:      rstate,
		MShell:      msh,
		RemoteCopy:  &rcopy,
	}
	if sessionId != "" && windowId != "" {
		state, err := sstore.GetRemoteState(ctx, sessionId, windowId, *rptr)
		if err != nil {
			return nil, fmt.Errorf("cannot resolve remote state '%s': %w", displayName, err)
		}
		if state == nil {
			state = rstate.DefaultState
		}
		rtn.RemoteState = state
	}
	return rtn, nil
}

// returns (remoteDisplayName, remoteptr, state, rstate, err)
func resolveRemote(ctx context.Context, fullRemoteRef string, sessionId string, windowId string) (string, *sstore.RemotePtrType, *sstore.RemoteState, *remote.RemoteRuntimeState, error) {
	if fullRemoteRef == "" {
		return "", nil, nil, nil, nil
	}
	userRef, remoteRef, remoteName, err := parseFullRemoteRef(fullRemoteRef)
	if err != nil {
		return "", nil, nil, nil, err
	}
	if userRef != "" {
		return "", nil, nil, nil, fmt.Errorf("invalid remote '%s', cannot resolve remote userid '%s'", fullRemoteRef, userRef)
	}
	rstate := remote.ResolveRemoteRef(remoteRef)
	if rstate == nil {
		return "", nil, nil, nil, fmt.Errorf("cannot resolve remote '%s': not found", fullRemoteRef)
	}
	rptr := sstore.RemotePtrType{RemoteId: rstate.RemoteId, Name: remoteName}
	state, err := sstore.GetRemoteState(ctx, sessionId, windowId, rptr)
	if err != nil {
		return "", nil, nil, nil, fmt.Errorf("cannot resolve remote state '%s': %w", fullRemoteRef, err)
	}
	rname := rstate.RemoteCanonicalName
	if rstate.RemoteAlias != "" {
		rname = rstate.RemoteAlias
	}
	if rptr.Name != "" {
		rname = fmt.Sprintf("%s:%s", rname, rptr.Name)
	}
	if state == nil {
		return rname, &rptr, rstate.DefaultState, rstate, nil
	}
	return rname, &rptr, state, rstate, nil
}
