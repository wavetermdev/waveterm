package scpacket

import (
	"reflect"

	"github.com/scripthaus-dev/mshell/pkg/base"
	"github.com/scripthaus-dev/mshell/pkg/packet"
	"github.com/scripthaus-dev/sh2-server/pkg/sstore"
)

const FeCommandPacketStr = "fecmd"
const WatchScreenPacketStr = "watchscreen"
const FeInputPacketStr = "feinput"
const RemoteInputPacketStr = "remoteinput"

type FeCommandPacketType struct {
	Type        string            `json:"type"`
	MetaCmd     string            `json:"metacmd"`
	MetaSubCmd  string            `json:"metasubcmd,omitempty"`
	Args        []string          `json:"args,omitempty"`
	Kwargs      map[string]string `json:"kwargs,omitempty"`
	UIContext   *UIContextType    `json:"uicontext,omitempty"`
	Interactive bool              `json:"interactive"`
}

type UIContextType struct {
	SessionId string                `json:"sessionid"`
	ScreenId  string                `json:"screenid"`
	WindowId  string                `json:"windowid"`
	Remote    *sstore.RemotePtrType `json:"remote,omitempty"`
	TermOpts  *packet.TermOpts      `json:"termopts,omitempty"`
}

type FeInputPacketType struct {
	Type        string               `json:"type"`
	CK          base.CommandKey      `json:"ck"`
	Remote      sstore.RemotePtrType `json:"remote"`
	InputData64 string               `json:"inputdata64"`
	SigName     string               `json:"signame,omitempty"`
	WinSize     *packet.WinSize      `json:"winsize,omitempty"`
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
}

func init() {
	packet.RegisterPacketType(FeCommandPacketStr, reflect.TypeOf(FeCommandPacketType{}))
	packet.RegisterPacketType(WatchScreenPacketStr, reflect.TypeOf(WatchScreenPacketType{}))
	packet.RegisterPacketType(FeInputPacketStr, reflect.TypeOf(FeInputPacketType{}))
	packet.RegisterPacketType(RemoteInputPacketStr, reflect.TypeOf(RemoteInputPacketType{}))
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
