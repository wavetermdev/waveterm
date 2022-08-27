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
	R_Session    = 1
	R_Screen     = 2
	R_Window     = 4
	R_Remote     = 8
	R_SessionOpt = 16
	R_ScreenOpt  = 32
	R_WindowOpt  = 64
	R_RemoteOpt  = 128
)

type resolvedIds struct {
	SessionId         string
	ScreenId          string
	WindowId          string
	RemotePtr         sstore.RemotePtrType
	RemoteState       *sstore.RemoteState
	RemoteDisplayName string
	RState            remote.RemoteState
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

func resolveIds(ctx context.Context, pk *scpacket.FeCommandPacketType, rtype int) (resolvedIds, error) {
	rtn := resolvedIds{}
	if rtype == 0 {
		return rtn, nil
	}
	var err error
	if (rtype&R_Session)+(rtype&R_SessionOpt) > 0 {
		rtn.SessionId, err = resolveSessionId(pk)
		if err != nil {
			return rtn, err
		}
		if rtn.SessionId == "" && (rtype&R_Session) > 0 {
			return rtn, fmt.Errorf("no session")
		}
	}
	if (rtype&R_Window)+(rtype&R_WindowOpt) > 0 {
		rtn.WindowId, err = resolveWindowId(pk, rtn.SessionId)
		if err != nil {
			return rtn, err
		}
		if rtn.WindowId == "" && (rtype&R_Window) > 0 {
			return rtn, fmt.Errorf("no window")
		}

	}
	if (rtype&R_Screen)+(rtype&R_ScreenOpt) > 0 {
		rtn.ScreenId, err = resolveScreenId(ctx, pk, rtn.SessionId)
		if err != nil {
			return rtn, err
		}
		if rtn.ScreenId == "" && (rtype&R_Screen) > 0 {
			return rtn, fmt.Errorf("no screen")
		}
	}
	if (rtype&R_Remote)+(rtype&R_RemoteOpt) > 0 {
		rname, rptr, state, rstate, err := resolveRemote(ctx, pk.Kwargs["remote"], rtn.SessionId, rtn.WindowId)
		if err != nil {
			return rtn, err
		}
		if rptr == nil && (rtype&R_Remote) > 0 {
			return rtn, fmt.Errorf("no remote")
		}
		rtn.RemoteDisplayName = rname
		rtn.RemotePtr = *rptr
		rtn.RemoteState = state
		rtn.RState = *rstate
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

func resolveWindowId(pk *scpacket.FeCommandPacketType, sessionId string) (string, error) {
	windowId := pk.Kwargs["window"]
	if windowId == "" {
		return "", nil
	}
	if _, err := uuid.Parse(windowId); err != nil {
		return "", fmt.Errorf("invalid windowid '%s'", windowId)
	}
	return windowId, nil
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

// returns (remoteDisplayName, remoteptr, state, rstate, err)
func resolveRemote(ctx context.Context, fullRemoteRef string, sessionId string, windowId string) (string, *sstore.RemotePtrType, *sstore.RemoteState, *remote.RemoteState, error) {
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
