package scpacket

import (
	"reflect"

	"github.com/scripthaus-dev/mshell/pkg/packet"
)

const FeCommandPacketStr = "fecmd"
const WatchScreenPacketStr = "watchscreen"

type RemoteState struct {
	RemoteId   string `json:"remoteid"`
	RemoteName string `json:"remotename"`
	Cwd        string `json:"cwd"`
}

type FeCommandPacketType struct {
	Type       string            `json:"type"`
	MetaCmd    string            `json:"metacmd"`
	MetaSubCmd string            `json:"metasubcmd,omitempty"`
	Args       []string          `json:"args,omitempty"`
	Kwargs     map[string]string `json:"kwargs,omitempty"`
}

func init() {
	packet.RegisterPacketType(FeCommandPacketStr, reflect.TypeOf(FeCommandPacketType{}))
	packet.RegisterPacketType(WatchScreenPacketStr, reflect.TypeOf(WatchScreenPacketType{}))
}

func (*FeCommandPacketType) GetType() string {
	return FeCommandPacketStr
}

func MakeFeCommandPacket() *FeCommandPacketType {
	return &FeCommandPacketType{Type: FeCommandPacketStr}
}

type WatchScreenPacketType struct {
	Type      string `json:"type"`
	SessionId string `json:"sessionid"`
	ScreenId  string `json:"screenid"`
}

func (*WatchScreenPacketType) GetType() string {
	return WatchScreenPacketStr
}

func MakeWatchScreenPacket() *WatchScreenPacketType {
	return &WatchScreenPacketType{Type: WatchScreenPacketStr}
}
