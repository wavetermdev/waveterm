// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package scpacket

import (
	"fmt"
	"reflect"
	"regexp"
	"strings"

	"github.com/alessio/shellescape"
	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/waveshell/pkg/base"
	"github.com/wavetermdev/waveterm/waveshell/pkg/packet"
	"github.com/wavetermdev/waveterm/waveshell/pkg/utilfn"
)

var RemoteNameRe = regexp.MustCompile("^\\*?[a-zA-Z0-9_-]+$")

type RemotePtrType struct {
	OwnerId  string `json:"ownerid"`
	RemoteId string `json:"remoteid"`
	Name     string `json:"name"`
}

func (r RemotePtrType) IsSessionScope() bool {
	return strings.HasPrefix(r.Name, "*")
}

func (rptr *RemotePtrType) GetDisplayName(baseDisplayName string) string {
	name := baseDisplayName
	if rptr == nil {
		return name
	}
	if rptr.Name != "" {
		name = name + ":" + rptr.Name
	}
	if rptr.OwnerId != "" {
		name = "@" + rptr.OwnerId + ":" + name
	}
	return name
}

func (r RemotePtrType) Validate() error {
	if r.OwnerId != "" {
		if _, err := uuid.Parse(r.OwnerId); err != nil {
			return fmt.Errorf("invalid ownerid format: %v", err)
		}
	}
	if r.RemoteId != "" {
		if _, err := uuid.Parse(r.RemoteId); err != nil {
			return fmt.Errorf("invalid remoteid format: %v", err)
		}
	}
	if r.Name != "" {
		ok := RemoteNameRe.MatchString(r.Name)
		if !ok {
			return fmt.Errorf("invalid remote name")
		}
	}
	return nil
}

func (r RemotePtrType) MakeFullRemoteRef() string {
	if r.RemoteId == "" {
		return ""
	}
	if r.OwnerId == "" && r.Name == "" {
		return r.RemoteId
	}
	if r.OwnerId != "" && r.Name == "" {
		return fmt.Sprintf("@%s:%s", r.OwnerId, r.RemoteId)
	}
	if r.OwnerId == "" && r.Name != "" {
		return fmt.Sprintf("%s:%s", r.RemoteId, r.Name)
	}
	return fmt.Sprintf("@%s:%s:%s", r.OwnerId, r.RemoteId, r.Name)
}

const FeCommandPacketStr = "fecmd"
const WatchScreenPacketStr = "watchscreen"
const FeInputPacketStr = "feinput"
const RemoteInputPacketStr = "remoteinput"
const CmdInputTextPacketStr = "cmdinputtext"

type FeCommandPacketType struct {
	Type        string            `json:"type"`
	MetaCmd     string            `json:"metacmd"`
	MetaSubCmd  string            `json:"metasubcmd,omitempty"`
	Args        []string          `json:"args,omitempty"`
	Kwargs      map[string]string `json:"kwargs,omitempty"`
	RawStr      string            `json:"rawstr,omitempty"`
	UIContext   *UIContextType    `json:"uicontext,omitempty"`
	Interactive bool              `json:"interactive"`
}

func (pk *FeCommandPacketType) GetRawStr() string {
	if pk.RawStr != "" {
		return pk.RawStr
	}
	cmd := "/" + pk.MetaCmd
	if pk.MetaSubCmd != "" {
		cmd = cmd + ":" + pk.MetaSubCmd
	}
	var args []string
	for k, v := range pk.Kwargs {
		argStr := fmt.Sprintf("%s=%s", shellescape.Quote(k), shellescape.Quote(v))
		args = append(args, argStr)
	}
	for _, arg := range pk.Args {
		args = append(args, shellescape.Quote(arg))
	}
	if len(args) == 0 {
		return cmd
	}
	return cmd + " " + strings.Join(args, " ")
}

type UIContextType struct {
	SessionId string          `json:"sessionid"`
	ScreenId  string          `json:"screenid"`
	Remote    *RemotePtrType  `json:"remote,omitempty"`
	WinSize   *packet.WinSize `json:"winsize,omitempty"`
	Build     string          `json:"build,omitempty"`
}

type FeInputPacketType struct {
	Type        string          `json:"type"`
	CK          base.CommandKey `json:"ck"`
	Remote      RemotePtrType   `json:"remote"`
	InputData64 string          `json:"inputdata64"`
	SigName     string          `json:"signame,omitempty"`
	WinSize     *packet.WinSize `json:"winsize,omitempty"`
}

type RemoteInputPacketType struct {
	Type        string `json:"type"`
	RemoteId    string `json:"remoteid"`
	InputData64 string `json:"inputdata64"`
}

type WatchScreenPacketType struct {
	Type      string `json:"type"`
	SessionId string `json:"sessionid"`
	ScreenId  string `json:"screenid"`
	Connect   bool   `json:"connect"`
	AuthKey   string `json:"authkey"`
}

type CmdInputTextPacketType struct {
	Type     string            `json:"type"`
	SeqNum   int               `json:"seqnum"`
	ScreenId string            `json:"screenid"`
	Text     utilfn.StrWithPos `json:"text"`
}

func init() {
	packet.RegisterPacketType(FeCommandPacketStr, reflect.TypeOf(FeCommandPacketType{}))
	packet.RegisterPacketType(WatchScreenPacketStr, reflect.TypeOf(WatchScreenPacketType{}))
	packet.RegisterPacketType(FeInputPacketStr, reflect.TypeOf(FeInputPacketType{}))
	packet.RegisterPacketType(RemoteInputPacketStr, reflect.TypeOf(RemoteInputPacketType{}))
	packet.RegisterPacketType(CmdInputTextPacketStr, reflect.TypeOf(CmdInputTextPacketType{}))
}

type PacketType interface {
	GetType() string
}

func (*CmdInputTextPacketType) GetType() string {
	return CmdInputTextPacketStr
}

func MakeCmdInputTextPacket(screenId string) *CmdInputTextPacketType {
	return &CmdInputTextPacketType{Type: CmdInputTextPacketStr, ScreenId: screenId}
}

func (*FeCommandPacketType) GetType() string {
	return FeCommandPacketStr
}

func MakeFeCommandPacket() *FeCommandPacketType {
	return &FeCommandPacketType{Type: FeCommandPacketStr}
}

func (*FeInputPacketType) GetType() string {
	return FeInputPacketStr
}

func MakeFeInputPacket() *FeInputPacketType {
	return &FeInputPacketType{Type: FeInputPacketStr}
}

func (*WatchScreenPacketType) GetType() string {
	return WatchScreenPacketStr
}

func MakeWatchScreenPacket() *WatchScreenPacketType {
	return &WatchScreenPacketType{Type: WatchScreenPacketStr}
}

func MakeRemoteInputPacket() *RemoteInputPacketType {
	return &RemoteInputPacketType{Type: RemoteInputPacketStr}
}

func (*RemoteInputPacketType) GetType() string {
	return RemoteInputPacketStr
}
